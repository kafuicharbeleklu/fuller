import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkTracker, isInspection, mayWrite, isDocFile, REPEAT_LIMIT, FAILURE_LIMIT } from '../src/agent/taskState.js';
import { turnDiff, isRisky, parseReview, reviewPrompt } from '../src/agent/review.js';

describe('commands', () => {
  it('tells looking around from checking', () => {
    expect(isInspection('ls -la && cat src/a.js | head -20')).toBe(true);
    expect(isInspection('git status')).toBe(true);
    expect(isInspection('npm test')).toBe(false);
    expect(isInspection('cd app && node --test')).toBe(false);
    expect(isInspection('node cli.js --shout')).toBe(false);
  });

  it('spots commands that may change files', () => {
    expect(mayWrite("sed -i 's/a/b/' x.js")).toBe(true);
    expect(mayWrite('echo hi > out.txt')).toBe(true);
    expect(mayWrite('git checkout -- src')).toBe(true);
    expect(mayWrite('npm test 2>&1')).toBe(false);
    expect(mayWrite('npm test > /dev/null 2>&1')).toBe(false);
    expect(mayWrite('grep -rn foo src')).toBe(false);
  });

  it('treats documentation as needing no check', () => {
    expect(isDocFile('README.md')).toBe(true);
    expect(isDocFile('docs/setup.json')).toBe(true);
    expect(isDocFile('src/a.ts')).toBe(false);
  });
});

describe('WorkTracker.beforeConclude', () => {
  it('asks for a check when code changed and nothing was run', () => {
    const work = new WorkTracker();
    work.noteChanges(['src/a.js']);
    const reminder = work.beforeConclude(null);
    expect(reminder?.kind).toBe('verify');
    expect(reminder?.text).toContain('`src/a.js` and ran no command to check the change');
    // Once per turn: the model may then conclude honestly.
    expect(work.beforeConclude(null)).toBeNull();
  });

  it('is satisfied by a passing check run after the last change', () => {
    const work = new WorkTracker();
    work.noteChanges(['src/a.js']);
    work.noteCommand('ls src', 'a.js');
    work.noteCommand('node --test', 'ok 1');
    expect(work.beforeConclude(null)).toBeNull();
  });

  it('asks again when files changed after the check', () => {
    const work = new WorkTracker();
    work.noteChanges(['src/a.js']);
    work.noteCommand('node --test', 'ok');
    work.noteChanges(['src/b.js']);
    const reminder = work.beforeConclude(null);
    expect(reminder?.kind).toBe('verify');
    expect(reminder?.text).toContain('changed `src/b.js` after your last check (`node --test`)');
  });

  it('asks to fix or explain a failed last check', () => {
    const work = new WorkTracker();
    work.noteChanges(['src/a.js']);
    work.noteCommand('npm test', 'not ok 1\n\n[Exit code: 1]');
    const reminder = work.beforeConclude(null);
    expect(reminder?.kind).toBe('failing');
    expect(reminder?.text).toContain('`npm test` exited with code 1');
    expect(work.beforeConclude(null)).toBeNull();
  });

  it('never blocks an analysis or a documentation change', () => {
    const work = new WorkTracker();
    expect(work.beforeConclude(null)).toBeNull();
    work.noteChanges(['README.md']);
    expect(work.beforeConclude(null)).toBeNull();
  });

  it('asks to finish or explain an unfinished task list', () => {
    const work = new WorkTracker();
    const reminder = work.beforeConclude([{ content: 'write tests', status: 'pending' }, { content: 'fix', status: 'completed' }]);
    expect(reminder?.kind).toBe('todos');
    expect(reminder?.text).toContain('- write tests (pending)');
    expect(reminder?.text).not.toContain('- fix');
  });
});

describe('WorkTracker.recordCall (no progress)', () => {
  it('warns on the same call repeated while no file changed, then stops', () => {
    const work = new WorkTracker();
    const args = { file_path: 'a.js' };
    for (let i = 1; i < REPEAT_LIMIT; i++) expect(work.recordCall('read_file', args).level).toBe('ok');
    const warn = work.recordCall('read_file', args);
    expect(warn).toEqual({ level: 'warn', reason: `the same read_file call ${REPEAT_LIMIT} times while no file changed` });
    expect(work.recordCall('read_file', args).level).toBe('stop');
  });

  it('does not count a call repeated after a change', () => {
    const work = new WorkTracker();
    for (let i = 0; i < REPEAT_LIMIT + 2; i++) {
      expect(work.recordCall('execute_bash', { command: 'npm test' }).level).toBe('ok');
      work.noteChanges(['src/a.js']);
    }
  });

  it('warns on the same failure with different arguments', () => {
    const work = new WorkTracker();
    for (let i = 1; i < FAILURE_LIMIT; i++) {
      expect(work.recordCall('edit_file', { file_path: 'a.js', target_content: `try ${i}` }, 'Error: 0 matches for target_content').level).toBe('ok');
    }
    const verdict = work.recordCall('edit_file', { file_path: 'a.js', target_content: 'again' }, 'Error: 0 matches for target_content');
    expect(verdict.level).toBe('warn');
  });

  it('ignores polling a background task', () => {
    const work = new WorkTracker();
    for (let i = 0; i < 10; i++) expect(work.recordCall('task_output', { task_id: 'b1' }).level).toBe('ok');
  });

  it('sees the same arguments in any key order as the same call', () => {
    const work = new WorkTracker();
    for (let i = 1; i < REPEAT_LIMIT; i++) work.recordCall('search_files', i % 2 ? { query: 'x', path: 'src' } : { path: 'src', query: 'x' });
    expect(work.recordCall('search_files', { query: 'x', path: 'src' }).level).toBe('warn');
  });
});

describe('review', () => {
  it('builds the diff of a turn from its first checkpoint to the current files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-review-'));
    fs.writeFileSync(path.join(dir, 'a.js'), 'const a = 2;\n');
    fs.writeFileSync(path.join(dir, 'new.js'), 'export {};\n');
    const diff = turnDiff([
      { id: '2', timestamp: 2, description: 'edit', files: [{ filePath: 'a.js', originalContent: 'const a = 1.5;\n' }] },
      { id: '1', timestamp: 1, description: 'edit', files: [{ filePath: 'a.js', originalContent: 'const a = 1;\n' }] },
      { id: '3', timestamp: 3, description: 'write', files: [{ filePath: 'new.js', originalContent: null }] },
    ], dir);
    expect(diff.files).toEqual(['a.js', 'new.js']);
    expect(diff.diff).toContain('-const a = 1;\n+const a = 2;');
    expect(diff.codeFiles).toBe(2);
    expect(diff.codeLines).toBe(3);
    expect(isRisky(diff)).toBe(false);
    expect(isRisky({ ...diff, codeLines: 400 })).toBe(true);
    expect(reviewPrompt('fix a', diff, 'Done.')).toContain('<request>\nfix a\n</request>');
  });

  it('reads the reviewer verdict', () => {
    expect(parseReview('NO_ISSUES')).toBeNull();
    expect(parseReview('**NO_ISSUES**')).toBeNull();
    expect(parseReview('I checked everything. NO_ISSUES')).toBeNull();
    expect(parseReview('src/a.js:3 — off by one — the last item is skipped')).toContain('src/a.js:3');
    expect(parseReview('(the subagent returned no text)')).toBeNull();
  });
});
