import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import stripAnsi from 'strip-ansi';

/** Collect staged and unstaged changes without invoking a shell. */
export function readGitDiff(cwd: string): string[] {
  const run = (args: string[]) => spawnSync('git', ['-c', 'color.ui=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const status = run(['status', '--short']);
  if (status.error || status.status !== 0) return [`git: ${status.error?.message || status.stderr || 'not a repository'}`];
  const unstaged = run(['diff', '--no-ext-diff']);
  const staged = run(['diff', '--cached', '--no-ext-diff']);
  const text = [
    'Working tree:', status.stdout.trimEnd() || '(clean)', '',
    'Unstaged changes:', unstaged.error?.message || unstaged.stdout || '(none)', '',
    'Staged changes:', staged.error?.message || staged.stdout || '(none)',
  ].join('\n');
  return stripAnsi(text).replace(/\r/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').split('\n');
}

export interface FileDiff {
  file: string;
  diff: string;
  additions: number;
  removals: number;
}

/** Untracked files larger than this are listed without their content. */
const MAX_NEW_FILE_BYTES = 200_000;

function countChanges(diff: string): { additions: number; removals: number } {
  let additions = 0, removals = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) removals++;
  }
  return { additions, removals };
}

/** A new file as a unified diff, read directly (one git call per file is too slow in big trees). */
function newFileDiff(cwd: string, file: string): string {
  try {
    const full = path.join(cwd, file);
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > MAX_NEW_FILE_BYTES) return '';
    const text = fs.readFileSync(full, 'utf8');
    if (text.includes('\u0000')) return '';
    const lines = text.replace(/\n$/, '').split('\n');
    return [`diff --git a/${file} b/${file}`, '--- /dev/null', `+++ b/${file}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join('\n') + '\n';
  } catch {
    return '';
  }
}

/** Each changed file against HEAD (untracked files as new), for the /diff panel. */
export function readFileDiffs(cwd: string): FileDiff[] | null {
  const run = (args: string[]) => spawnSync('git', ['-c', 'color.ui=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const top = run(['rev-parse', '--show-toplevel']);
  if (top.error || top.status !== 0) return null;
  const hasHead = run(['rev-parse', '--verify', '--quiet', 'HEAD']).status === 0;
  const clean = (text: string) => stripAnsi(text).replace(/\r/g, '');
  const out: FileDiff[] = [];
  // One call for every tracked change, split per file.
  const all = clean(run(['diff', ...(hasHead ? ['HEAD'] : ['--cached']), '--no-ext-diff', '--relative']).stdout);
  for (const chunk of all.split(/^(?=diff --git )/m).filter((c) => c.startsWith('diff --git '))) {
    const header = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const file = header?.[2] ?? '';
    if (file) out.push({ file, diff: chunk, ...countChanges(chunk) });
  }
  for (const file of run(['ls-files', '--others', '--exclude-standard']).stdout.split('\n').filter(Boolean)) {
    const diff = newFileDiff(cwd, file);
    out.push({ file, diff, ...countChanges(diff) });
  }
  return out;
}
