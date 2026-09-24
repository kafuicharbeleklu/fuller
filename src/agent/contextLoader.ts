import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CONFIG_DIR_NAME, MEMORY_FILE } from '../branding.js';

export interface MemoryFile {
  path: string;
  content: string;
  scope: 'user' | 'project' | 'local';
}

const CANDIDATES = [MEMORY_FILE, path.join(CONFIG_DIR_NAME, MEMORY_FILE)];
const MAX_IMPORT_DEPTH = 4;
const MAX_FILE_BYTES = 200 * 1024;

function readSafe(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Resolve `@path` imports (Claude Code syntax), skipping fenced code blocks. */
export function resolveImports(content: string, baseDir: string, depth = 0, seen = new Set<string>()): string {
  if (depth >= MAX_IMPORT_DEPTH) return content;
  const lines = content.split('\n');
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inFence = !inFence; out.push(line); continue; }
    if (inFence) { out.push(line); continue; }
    const replaced = line.replace(/(^|\s)@((?:~|\.{0,2})\/?[\w./-]+)/g, (m, pre: string, p: string) => {
      const target = p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : path.resolve(baseDir, p);
      if (seen.has(target)) return m;
      const imported = readSafe(target);
      if (imported === null) return m;
      seen.add(target);
      const body = resolveImports(imported, path.dirname(target), depth + 1, seen);
      return `${pre}\n<!-- imported from ${p} -->\n${body}\n<!-- end import -->`;
    });
    out.push(replaced);
  }
  return out.join('\n');
}

export function loadProjectContext(workspaceDir: string): MemoryFile[] {
  const files: MemoryFile[] = [];
  const seen = new Set<string>();

  const userFile = path.join(os.homedir(), CONFIG_DIR_NAME, MEMORY_FILE);
  const userContent = readSafe(userFile);
  if (userContent !== null) {
    files.push({ path: userFile, content: resolveImports(userContent, path.dirname(userFile), 0, seen), scope: 'user' });
  }

  const chain: string[] = [];
  let dir = path.resolve(workspaceDir);
  for (let i = 0; i < 8; i++) {
    chain.unshift(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const home = os.homedir();
  for (const d of chain) {
    if (d === home || d === path.dirname(home) || d === '/') continue;
    for (const candidate of CANDIDATES) {
      const file = path.join(d, candidate);
      const content = readSafe(file);
      if (content !== null) {
        files.push({ path: file, content: resolveImports(content, path.dirname(file), 0, seen), scope: 'project' });
        break;
      }
    }
    const local = path.join(d, 'FULLER.local.md');
    const localContent = readSafe(local);
    if (localContent !== null) {
      files.push({ path: local, content: resolveImports(localContent, d, 0, seen), scope: 'local' });
    }
  }
  return files;
}

export function memoryFilePath(workspaceDir: string): string {
  for (const candidate of CANDIDATES) {
    const file = path.join(workspaceDir, candidate);
    if (fs.existsSync(file)) return file;
  }
  return path.join(workspaceDir, MEMORY_FILE);
}
