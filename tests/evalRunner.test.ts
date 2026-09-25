import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const runner = path.resolve('scripts/eval.mjs');
const source = path.resolve('evals/tasks/fix-off-by-one');

const cleanups: string[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

/** A copy of one task with a chosen solution.patch (and task.json fields changed if asked). */
function taskWith(patch: string, taskFields: Record<string, unknown> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-evaltasks-'));
  cleanups.push(dir);
  const copy = path.join(dir, 'fix-off-by-one');
  fs.cpSync(source, copy, { recursive: true });
  fs.writeFileSync(path.join(copy, 'solution.patch'), patch);
  const task = JSON.parse(fs.readFileSync(path.join(copy, 'task.json'), 'utf8'));
  fs.writeFileSync(path.join(copy, 'task.json'), JSON.stringify({ ...task, ...taskFields }));
  return dir;
}
const realFix = fs.readFileSync(path.join(source, 'solution.patch'), 'utf8');
const cheat = [
  'diff --git a/test/range.test.js b/test/range.test.js',
  '--- a/test/range.test.js',
  '+++ b/test/range.test.js',
  '@@ -3,6 +3,6 @@ import assert from \'node:assert/strict\';',
  " import { sumRange } from '../src/range.js';",
  ' ',
  " test('includes both ends', () => {",
  '-  assert.equal(sumRange(1, 3), 6);',
  '-  assert.equal(sumRange(5, 5), 5);',
  '+  assert.equal(sumRange(1, 3), 3);',
  '+  assert.equal(sumRange(5, 5), 0);',
  ' });',
  '',
].join('\n');
// A good fix that also adds a test file.
const extraTest = [
  'diff --git a/test/extra.test.js b/test/extra.test.js',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/test/extra.test.js',
  '@@ -0,0 +1,4 @@',
  "+import test from 'node:test';",
  "+import assert from 'node:assert/strict';",
  "+import { sumRange } from '../src/range.js';",
  "+test('empty range', () => assert.equal(sumRange(3, 2), 0));",
  '',
].join('\n');
const run = (tasks: string) => spawnSync('node', [runner, '--verify-solutions'], { env: { ...process.env, EVAL_TASKS_DIR: tasks }, encoding: 'utf8' });

describe('benchmark runner (lot 0)', () => {
  it('accepts the real fix', () => {
    const res = run(taskWith(realFix));
    expect(res.stdout).toContain('reference solution passes');
    expect(res.status).toBe(0);
  });

  it('rejects a "fix" that edits the test instead of the code', () => {
    const res = run(taskWith(cheat));
    expect(res.stdout).toContain('REFERENCE SOLUTION FAILS — Modified protected files: test/range.test.js');
    expect(res.status).toBe(1);
  });

  it('without mustNotChange, the original tests are put back: the cheat still fails', () => {
    const res = run(taskWith(cheat, { mustNotChange: undefined }));
    expect(res.stdout).toContain('REFERENCE SOLUTION FAILS');
    expect(res.stdout).not.toContain('Modified protected files');
    expect(res.status).toBe(1);
  });

  it('without mustNotChange, a real fix that adds tests passes', () => {
    const res = run(taskWith(realFix + extraTest, { mustNotChange: undefined }));
    expect(res.stdout).toContain('reference solution passes');
    expect(res.status).toBe(0);
  });

  it('with mustNotChange, adding a test fails the task', () => {
    const res = run(taskWith(realFix + extraTest));
    expect(res.stdout).toContain('Modified protected files');
    expect(res.status).toBe(1);
  });
});
