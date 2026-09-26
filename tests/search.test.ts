import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchFiles, formatSearchOutput, findRipgrep } from '../src/tools/search.js';

describe('search_files', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-search-'));
  afterAll(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.writeFileSync(path.join(cwd, 'src', 'a.ts'), 'const alpha = 1;\nconst beta = 2;\n// TODO alpha again\n');
  fs.writeFileSync(path.join(cwd, 'src', 'b.md'), 'alpha in markdown\n');
  fs.writeFileSync(path.join(cwd, '.gitignore'), 'ignored.ts\n');
  fs.writeFileSync(path.join(cwd, 'ignored.ts'), 'alpha ignored\n');

  it('finds matches, respects .gitignore and globs', async () => {
    const res = await searchFiles('alpha', cwd);
    const files = new Set(res.matches.map((m) => m.file));
    expect(files.has('src/a.ts')).toBe(true);
    expect(files.has('src/b.md')).toBe(true);
    expect(files.has('ignored.ts')).toBe(false);
    const ts = await searchFiles('alpha', cwd, { glob: '**/*.ts' });
    expect(new Set(ts.matches.map((m) => m.file))).toEqual(new Set(['src/a.ts']));
    expect(ts.matches.map((m) => m.line)).toEqual([1, 3]);
  });

  it('supports regex, case-insensitivity and the output modes', async () => {
    const res = await searchFiles('ALPHA|beta', cwd, { regex: true, ignoreCase: true });
    expect(res.matches.filter((m) => !m.context)).toHaveLength(4);
    expect(formatSearchOutput('x', res, 'files_with_matches')).toMatch(/2 files with matches:\n/);
    expect(formatSearchOutput('x', res, 'count')).toMatch(/src\/a\.ts: 3/);
    expect(formatSearchOutput('x', res, 'content', 2).split('\n')).toHaveLength(3);
  });

  it('searches one file when the path names a file (real session, 26/09: always "0 matches" before)', async () => {
    const res = await searchFiles('alpha', cwd, { path: 'src/a.ts' });
    expect(res.matches.map((m) => [m.file, m.line])).toEqual([['src/a.ts', 1], ['src/a.ts', 3]]);
    expect((await searchFiles('beta', cwd, { path: path.join(cwd, 'src', 'a.ts') })).matches).toHaveLength(1);
    expect((await searchFiles('gamma', cwd, { path: 'src/a.ts' })).matches).toHaveLength(0);
  });

  it('reports which backend was used', async () => {
    const res = await searchFiles('alpha', cwd);
    const rg = await findRipgrep();
    expect(res.backend).toBe(rg ? 'ripgrep' : 'js');
  });

  it('tells the model when a literal search looks like a regular expression and finds nothing (real session, 25/09)', () => {
    const none = { matches: [], truncated: false, backend: 'js' as const, filesScanned: 3 };
    expect(formatSearchOutput('mkdtempSync|afterEach|rmSync', none)).toContain('pass regex: true for a pattern');
    expect(formatSearchOutput('mkdtempSync|afterEach|rmSync', none, 'content', undefined, { regex: true })).not.toContain('regex: true');
    expect(formatSearchOutput('plainword', none)).not.toContain('regex: true');
  });

  it('rejects invalid regular expressions', async () => {
    await expect(searchFiles('(', cwd, { regex: true })).rejects.toThrow(/Invalid regular expression/);
  });
});
