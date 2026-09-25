import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isTestOrGenerated, nextDiffBase, defaultBranch, readFileDiffs } from '../src/ui/gitDiff.js';

describe('files the /diff panel leaves out', () => {
  it('recognises test files and generated files, not ordinary sources', () => {
    for (const f of ['tests/loop.test.ts', 'src/__tests__/a.tsx', 'a.spec.js', 'pkg/x_test.go', 'test_api.py', 'spec/a_spec.rb', 'package-lock.json', 'yarn.lock', 'dist/index.js', 'build/a.css', 'app.min.js', 'app.js.map', 'a.snap', 'proto/a.pb.go', 'reports/tui/x.cast']) {
      expect(isTestOrGenerated(f), f).toBe(true);
    }
    for (const f of ['src/agent/loop.ts', 'README.md', 'scripts/eval.mjs', 'src/testing.ts', 'contest/a.ts', 'package.json']) {
      expect(isTestOrGenerated(f), f).toBe(false);
    }
  });

  it('cycles the base: this session → uncommitted → since the default branch → this session', () => {
    expect(nextDiffBase('session')).toBe('uncommitted');
    expect(nextDiffBase('uncommitted')).toBe('branch');
    expect(nextDiffBase('branch')).toBe('session');
  });
});

describe('the branch base', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-diffbase-'));
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('lists what changed since the branch left the default branch, plus the working tree', () => {
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
    git('add', '-A'); git('commit', '-qm', 'init');
    git('checkout', '-qb', 'feature');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
    git('add', '-A'); git('commit', '-qm', 'on the branch');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\nc\n');
    expect(defaultBranch(dir)).toBe('main');
    const uncommitted = readFileDiffs(dir, 'uncommitted')!.map((f) => f.file);
    expect(uncommitted).toEqual(['b.txt']);
    const branch = readFileDiffs(dir, 'branch')!.map((f) => f.file);
    expect(branch).toEqual(['a.txt', 'b.txt']);
    // On the default branch itself, the fork point is HEAD: the branch base equals the uncommitted one.
    git('checkout', '-q', 'main');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\nc\n');
    expect(readFileDiffs(dir, 'branch')!.map((f) => f.file)).toEqual(['b.txt']);
  });
});
