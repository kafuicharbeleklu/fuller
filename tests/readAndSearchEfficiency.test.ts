import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dispatchTool } from '../src/tools/registry.js';
import { FileTracker } from '../src/tools/fileTracker.js';
import { searchFiles, formatSearchOutput } from '../src/tools/search.js';

// Both come from a real session (26/09): a 665-line file read in 15 slices of about 50 lines, and
// 91 searches for one change, most followed by a read of the lines around the match.
let dir: string;
let tracker: FileTracker;
const ctx = () => ({ cwd: dir, extraDirs: [], fileTracker: tracker } as any);
const lines = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-read-')); tracker = new FileTracker(); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('read_file reads small and medium files whole', () => {
  it('returns a file of 300 lines or less whole, even with offset and limit', async () => {
    fs.writeFileSync(path.join(dir, 'small.ts'), lines(250));
    const r = await dispatchTool('read_file', { file_path: 'small.ts', offset: 100, limit: 20 }, ctx());
    expect(r.summary).toBe('Read 250 lines');
    expect(r.output.split('\n')[0]).toBe('[Whole file (250 lines): small enough to read at once, offset/limit ignored.]');
    expect(r.output).toContain('  1\tline 1');
    expect(r.output).toContain('250\tline 250');
  });

  it('reads a medium file whole from its second partial read, and a large one always in parts', async () => {
    fs.writeFileSync(path.join(dir, 'medium.ts'), lines(665));
    const first = await dispatchTool('read_file', { file_path: 'medium.ts', offset: 475, limit: 60 }, ctx());
    expect(first.summary).toBe('Read 60 lines (of 665)');
    const second = await dispatchTool('read_file', { file_path: 'medium.ts', offset: 630, limit: 40 }, ctx());
    expect(second.summary).toBe('Read 665 lines');
    fs.writeFileSync(path.join(dir, 'large.ts'), lines(1754));
    for (const offset of [500, 800, 1700]) {
      const part = await dispatchTool('read_file', { file_path: 'large.ts', offset, limit: 50 }, ctx());
      expect(part.summary).toMatch(/of 1754\)$/);
    }
  });

  it('leaves a read without offset or limit as it was', async () => {
    fs.writeFileSync(path.join(dir, 'plain.ts'), lines(10));
    const r = await dispatchTool('read_file', { file_path: 'plain.ts' }, ctx());
    expect(r.output.startsWith('[Whole file')).toBe(false);
    expect(r.summary).toBe('Read 10 lines');
  });
});

describe('search_files gives the code around a few matches', () => {
  const source = ['import x from "y";', '', 'export function compactHistory(history) {', '  const text = toText(history);', '  return summarize(text);', '}', '', ...Array.from({ length: 30 }, (_, i) => `// filler ${i}`), 'compactHistory(h);'].join('\n');

  it('adds 10 lines around each match when there are 3 matches or fewer, keeping indentation', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), source);
    const r = await dispatchTool('search_files', { query: 'compactHistory' }, ctx());
    expect(r.summary).toMatch(/^2 matches/);
    expect(r.output).toContain('a.ts:3: export function compactHistory(history) {');
    expect(r.output).toContain('a.ts-4-   const text = toText(history);');
    expect(r.output).toContain('a.ts-1- import x from "y";');
    expect(r.output).toContain('a.ts:38: compactHistory(h);');
    expect(r.output).not.toContain('a.ts-15-');
    expect(r.output.trimEnd().endsWith('[10 lines of context around each match]')).toBe(true);
  });

  it('keeps bare matches when there are more than 3, or when another mode or context was asked', async () => {
    fs.writeFileSync(path.join(dir, 'b.ts'), 'hit\nhit\nhit\nhit\n');
    const many = await dispatchTool('search_files', { query: 'hit' }, ctx());
    expect(many.output).not.toContain('lines of context');
    fs.writeFileSync(path.join(dir, 'a.ts'), source);
    const files = await dispatchTool('search_files', { query: 'compactHistory', output_mode: 'files_with_matches' }, ctx());
    expect(files.output).not.toContain('lines of context');
    const asked = await dispatchTool('search_files', { query: 'toText', context_lines: 1 }, ctx());
    expect(asked.output).toContain('a.ts-3- export function compactHistory(history) {');
    expect(asked.output).not.toContain('a.ts-1-');
    expect(asked.output).not.toContain('lines of context around');
  });

  it('honours context_lines without ripgrep too', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), source);
    const res = await searchFiles('toText', dir, { contextLines: 2 });
    expect(formatSearchOutput('toText', res)).toContain('a.ts-2-');
    expect(res.matches.filter((m) => m.context).map((m) => m.line)).toEqual([2, 3, 5, 6]);
  });
});
