import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import ignore, { type Ignore } from 'ignore';
import { assertReadable, isSensitivePath, resolveInWorkspace } from './paths.js';
import { LIMITS, isProbablyBinary, truncateHead } from './truncate.js';

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
}

const ALWAYS_IGNORED = ['node_modules', '.git', 'dist', 'build', '.next', '.cache', '__pycache__', '.venv', 'venv', 'coverage', '.turbo'];

const ignoreCache = new Map<string, { mtime: number; ig: Ignore }>();

export async function loadIgnore(cwd: string): Promise<Ignore> {
  const file = path.join(cwd, '.gitignore');
  let mtime = 0;
  let content = '';
  try {
    const stat = await fs.stat(file);
    mtime = stat.mtimeMs;
    const cached = ignoreCache.get(cwd);
    if (cached && cached.mtime === mtime) return cached.ig;
    content = await fs.readFile(file, 'utf8');
  } catch {}
  const ig = ignore().add(ALWAYS_IGNORED).add(content);
  ignoreCache.set(cwd, { mtime, ig });
  return ig;
}

function relFor(ig: Ignore, cwd: string, full: string, isDir: boolean): boolean {
  const rel = path.relative(cwd, full).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) return false;
  return ig.ignores(isDir ? rel + '/' : rel);
}

export async function listDirectory(
  dirPath: string,
  cwd: string,
  recursive = false,
  extraDirs: string[] = []
): Promise<FileEntry[]> {
  const targetDir = resolveInWorkspace(dirPath || '.', cwd, extraDirs);
  const ig = await loadIgnore(cwd);
  const entries: FileEntry[] = [];

  async function scan(current: string, depth: number) {
    if (depth > 2 || entries.length >= LIMITS.listEntries) return;
    let items;
    try {
      items = await fs.readdir(current, { withFileTypes: true });
    } catch (err: any) {
      throw new Error(`Impossible de lister ${dirPath}: ${err.message}`);
    }
    items.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const item of items) {
      if (entries.length >= LIMITS.listEntries) return;
      const full = path.join(current, item.name);
      const isDir = item.isDirectory();
      if (relFor(ig, cwd, full, isDir)) continue;
      let size: number | undefined;
      if (!isDir) {
        try { size = (await fs.stat(full)).size; } catch {}
      }
      entries.push({ name: path.relative(targetDir, full) + (isDir ? '/' : ''), isDirectory: isDir, size });
      if (isDir && recursive) await scan(full, depth + 1);
    }
  }

  await scan(targetDir, 0);
  return entries;
}

export interface SearchOptions {
  regex?: boolean;
  ignoreCase?: boolean;
  glob?: string;
  path?: string;
  maxResults?: number;
  extraDirs?: string[];
  contextLines?: number;
}

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

export async function searchFiles(
  query: string,
  cwd: string,
  options: SearchOptions = {}
): Promise<{ matches: SearchMatch[]; filesScanned: number; truncated: boolean }> {
  if (!query) throw new Error('query est requis.');
  const root = resolveInWorkspace(options.path || '.', cwd, options.extraDirs);
  const maxResults = Math.min(options.maxResults ?? LIMITS.searchResults, 1000);
  const flags = options.ignoreCase ? 'i' : '';
  let re: RegExp;
  try {
    re = options.regex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  } catch (err: any) {
    throw new Error(`Expression régulière invalide : ${err.message}`);
  }
  const ig = await loadIgnore(cwd);
  const files = await fg(options.glob || '**/*', {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
    ignore: ALWAYS_IGNORED.map((d) => `**/${d}/**`),
    suppressErrors: true,
  });

  const matches: SearchMatch[] = [];
  let filesScanned = 0;
  let truncated = false;
  for (const full of files) {
    if (matches.length >= maxResults) { truncated = true; break; }
    if (relFor(ig, cwd, full, false) || isSensitivePath(full)) continue;
    let stat;
    try { stat = await fs.stat(full); } catch { continue; }
    if (stat.size > LIMITS.searchFileBytes) continue;
    const buf = await fs.readFile(full);
    if (isProbablyBinary(buf)) continue;
    filesScanned++;
    const lines = buf.toString('utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        matches.push({ file: path.relative(cwd, full), line: i + 1, text: lines[i].trim().slice(0, 300) });
        if (matches.length >= maxResults) { truncated = true; break; }
      }
    }
  }
  return { matches, filesScanned, truncated };
}

export async function globFiles(pattern: string, cwd: string, extraDirs: string[] = [], base?: string): Promise<{ files: string[]; truncated: boolean }> {
  if (!pattern) throw new Error('pattern est requis.');
  const root = resolveInWorkspace(base || '.', cwd, extraDirs);
  const ig = await loadIgnore(cwd);
  const entries = await fg(pattern, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    stats: true,
    ignore: ALWAYS_IGNORED.map((d) => `**/${d}/**`),
    suppressErrors: true,
  });
  const filtered = entries
    .filter((e) => !relFor(ig, cwd, e.path, false))
    .sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));
  const truncated = filtered.length > LIMITS.globFiles;
  return { files: filtered.slice(0, LIMITS.globFiles).map((e) => path.relative(cwd, e.path)), truncated };
}

export function formatSearchOutput(query: string, res: { matches: SearchMatch[]; filesScanned: number; truncated: boolean }): string {
  if (res.matches.length === 0) return `No matches found for "${query}" (${res.filesScanned} files scanned).`;
  const body = res.matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join('\n');
  const head = `${res.matches.length}${res.truncated ? '+' : ''} matches in ${new Set(res.matches.map((m) => m.file)).size} files${res.truncated ? ' (result limit reached — refine the query)' : ''}:\n`;
  return truncateHead(head + body, LIMITS.searchOutput);
}

export async function readableExists(p: string, cwd: string, extraDirs: string[] = []): Promise<boolean> {
  try {
    await fs.access(assertReadable(p, cwd, extraDirs));
    return true;
  } catch {
    return false;
  }
}
