import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
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
      throw new Error(`Cannot list ${dirPath}: ${err.message}`);
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

export type SearchOutputMode = 'content' | 'files_with_matches' | 'count';

export interface SearchOptions {
  regex?: boolean;
  ignoreCase?: boolean;
  glob?: string;
  path?: string;
  maxResults?: number;
  extraDirs?: string[];
  contextLines?: number;
  outputMode?: SearchOutputMode;
  signal?: AbortSignal;
}

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
  /** true for context lines (-C) rather than matches. */
  context?: boolean;
}

export interface SearchResult {
  matches: SearchMatch[];
  filesScanned: number;
  truncated: boolean;
  backend: 'ripgrep' | 'js';
}

let rgPath: string | null | undefined;

/** Path of the ripgrep binary when available (system `rg`, or FULLER_RG). */
export async function findRipgrep(): Promise<string | null> {
  if (rgPath !== undefined) return rgPath;
  const candidates = [process.env.FULLER_RG, ...(process.env.PATH ?? '').split(path.delimiter).map((d) => path.join(d, 'rg'))].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      await fs.access(c, (await import('node:fs')).constants.X_OK);
      rgPath = c;
      return c;
    } catch {}
  }
  rgPath = null;
  return null;
}

async function searchWithRipgrep(rg: string, query: string, root: string, cwd: string, options: SearchOptions, maxResults: number): Promise<SearchResult> {
  // --no-require-git: honour .gitignore even outside a git repository (like the JS fallback).
  // Explicit --glob patterns override ignore files in ripgrep, so .gitignore is re-applied below.
  const ig = await loadIgnore(cwd);
  const args = ['--json', '--no-messages', '--no-require-git', '--max-columns', '300', '--max-columns-preview', '--max-filesize', `${LIMITS.searchFileBytes}`];
  if (!options.regex) args.push('--fixed-strings');
  if (options.ignoreCase) args.push('--ignore-case');
  if (options.glob) args.push('--glob', options.glob);
  if (options.contextLines && options.contextLines > 0) args.push('-C', String(Math.min(10, options.contextLines)));
  for (const d of ALWAYS_IGNORED) args.push('--glob', `!**/${d}/**`);
  args.push('-e', query, root);
  return new Promise((resolve, reject) => {
    const child = spawn(rg, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const matches: SearchMatch[] = [];
    const files = new Set<string>();
    let truncated = false;
    let buffer = '';
    let stderr = '';
    const onAbort = () => child.kill('SIGTERM');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const handle = (line: string) => {
      if (!line || truncated) return;
      let ev: any;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type !== 'match' && ev.type !== 'context') return;
      const full = String(ev.data.path?.text ?? '');
      if (relFor(ig, cwd, full, false)) return;
      const file = path.relative(cwd, full);
      files.add(file);
      matches.push({ file, line: ev.data.line_number ?? 0, text: String(ev.data.lines?.text ?? '').replace(/\r?\n$/, '').trim().slice(0, 300), context: ev.type === 'context' });
      if (matches.filter((m) => !m.context).length >= maxResults) { truncated = true; child.kill('SIGTERM'); }
    };
    child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString('utf8');
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const p of parts) handle(p);
    });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => { options.signal?.removeEventListener('abort', onAbort); reject(err); });
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort);
      if (buffer) handle(buffer);
      if (options.signal?.aborted) { reject(new Error('Interrupted')); return; }
      if (code === 2 && matches.length === 0 && /regex parse error|error parsing/i.test(stderr)) { reject(new Error(`Invalid regular expression: ${stderr.trim().split('\n')[0]}`)); return; }
      resolve({ matches, filesScanned: files.size, truncated, backend: 'ripgrep' });
    });
  });
}


export async function searchFiles(
  query: string,
  cwd: string,
  options: SearchOptions = {}
): Promise<SearchResult> {
  if (!query) throw new Error('query is required.');
  const root = resolveInWorkspace(options.path || '.', cwd, options.extraDirs);
  const maxResults = Math.min(options.maxResults ?? LIMITS.searchResults, 1000);
  const rg = await findRipgrep();
  if (rg) {
    try {
      return await searchWithRipgrep(rg, query, root, cwd, options, maxResults);
    } catch (err: any) {
      if (err?.message === 'Interrupted' || /invalide/.test(err?.message ?? '')) throw err;
      // fall back to the JS implementation below
    }
  }
  const flags = options.ignoreCase ? 'i' : '';
  let re: RegExp;
  try {
    re = options.regex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  } catch (err: any) {
    throw new Error(`Invalid regular expression: ${err.message}`);
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
  return { matches, filesScanned, truncated, backend: 'js' };
}

export async function globFiles(pattern: string, cwd: string, extraDirs: string[] = [], base?: string): Promise<{ files: string[]; truncated: boolean }> {
  if (!pattern) throw new Error('pattern is required.');
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

/** Characters that only mean something in a regular expression: a literal search for `a|b` finds nothing. */
const REGEX_CHARS = /[|()[\]\\^$*+?{}]/;

export function formatSearchOutput(query: string, res: SearchResult, mode: SearchOutputMode = 'content', headLimit?: number, options: { regex?: boolean } = {}): string {
  const real = res.matches.filter((m) => !m.context);
  if (real.length === 0) {
    // Seen in a real session (25/09): the same `a|b|c` query searched literally twenty times, zero matches each time.
    const hint = !options.regex && REGEX_CHARS.test(query) ? ' The query contains regular-expression characters but was searched literally: pass regex: true for a pattern, or search one plain word.' : '';
    return `No matches found for "${query}"${res.backend === 'js' ? ` (${res.filesScanned} files scanned)` : ''}.${hint}`;
  }
  const byFile = new Map<string, number>();
  for (const m of real) byFile.set(m.file, (byFile.get(m.file) ?? 0) + 1);
  const limit = headLimit && headLimit > 0 ? headLimit : undefined;
  if (mode === 'files_with_matches') {
    const files = [...byFile.keys()];
    const shown = limit ? files.slice(0, limit) : files;
    return truncateHead(`${files.length} files with matches${limit && files.length > limit ? ` (showing ${limit})` : ''}:\n${shown.join('\n')}`, LIMITS.searchOutput);
  }
  if (mode === 'count') {
    const rows = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
    const shown = limit ? rows.slice(0, limit) : rows;
    return truncateHead(`${real.length} matches in ${byFile.size} files:\n${shown.map(([f, n]) => `${f}: ${n}`).join('\n')}`, LIMITS.searchOutput);
  }
  const lines = res.matches.map((m) => `${m.file}${m.context ? '-' : ':'}${m.line}${m.context ? '-' : ':'} ${m.text}`);
  const shown = limit ? lines.slice(0, limit) : lines;
  const head = `${real.length}${res.truncated ? '+' : ''} matches in ${byFile.size} files${res.truncated ? ' (result limit reached — refine the query)' : ''}${limit && lines.length > limit ? ` (showing first ${limit} lines)` : ''}:\n`;
  return truncateHead(head + shown.join('\n'), LIMITS.searchOutput);
}

export async function readableExists(p: string, cwd: string, extraDirs: string[] = []): Promise<boolean> {
  try {
    await fs.access(assertReadable(p, cwd, extraDirs));
    return true;
  } catch {
    return false;
  }
}
