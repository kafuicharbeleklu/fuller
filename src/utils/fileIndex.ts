import fg from 'fast-glob';
import path from 'node:path';
import { loadIgnore } from '../tools/search.js';

const MAX_FILES = 8000;
const TTL = 30_000;
const cache = new Map<string, { at: number; files: string[] }>();

/** Cached list of project files (relative paths) for `@` completion. */
export async function getFileIndex(cwd: string): Promise<string[]> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < TTL) return hit.files;
  const ig = await loadIgnore(cwd);
  const entries = await fg('**/*', {
    cwd,
    onlyFiles: false,
    markDirectories: true,
    dot: false,
    followSymbolicLinks: false,
    suppressErrors: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**', '**/coverage/**'],
    deep: 8,
  });
  const files = entries
    .map((e) => e.split(path.sep).join('/'))
    .filter((e) => !ig.ignores(e))
    .slice(0, MAX_FILES)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  cache.set(cwd, { at: Date.now(), files });
  return files;
}

/** Simple fuzzy scoring: substring on basename > substring on path > subsequence. */
export function fuzzyFilter(items: string[], query: string, limit = 8): string[] {
  const q = query.toLowerCase();
  if (!q) return items.slice(0, limit);
  const scored: Array<{ item: string; score: number }> = [];
  for (const item of items) {
    const lower = item.toLowerCase();
    const base = path.basename(lower);
    let score = -1;
    if (base.startsWith(q)) score = 1000 - item.length;
    else if (base.includes(q)) score = 800 - item.length;
    else if (lower.includes(q)) score = 600 - item.length;
    else {
      let qi = 0;
      for (let i = 0; i < lower.length && qi < q.length; i++) if (lower[i] === q[qi]) qi++;
      if (qi === q.length) score = 300 - item.length;
    }
    if (score >= 0) scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.item);
}
