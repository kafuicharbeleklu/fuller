import fs from 'node:fs';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import type { Checkpoint } from '../checkpoint/manager.js';
import type { SubagentDefinition } from './subagents.js';
import { isDocFile } from './taskState.js';

/**
 * Independent review of a turn's changes before the agent concludes (as Aider's and OpenHands'
 * reviewers do): a read-only subagent reads the diff against the request and reports concrete
 * defects only. It runs once per turn, on large changes by default (settings.reviewChanges).
 */

export interface TurnDiff {
  diff: string;
  files: string[];
  /** Added plus removed lines, outside documentation. */
  codeLines: number;
  codeFiles: number;
}

/** Hypotheses to measure: a change this large deserves a second reading. */
export const REVIEW_MIN_FILES = 4;
export const REVIEW_MIN_LINES = 150;
const MAX_DIFF = 60_000;

/** Every file the turn changed, from its state before the turn's first edit to now. */
export function turnDiff(checkpoints: Checkpoint[], workspaceDir: string): TurnDiff {
  const before = new Map<string, string | null>();
  for (const checkpoint of [...checkpoints].sort((a, b) => a.timestamp - b.timestamp)) {
    for (const file of checkpoint.files) if (!before.has(file.filePath)) before.set(file.filePath, file.originalContent);
  }
  const patches: string[] = [];
  const files: string[] = [];
  let codeLines = 0;
  let codeFiles = 0;
  for (const [file, original] of before) {
    let current: string | null = null;
    try { current = fs.readFileSync(path.resolve(workspaceDir, file), 'utf8'); } catch {}
    if (current === original) continue;
    const patch = createTwoFilesPatch(`a/${file}`, `b/${file}`, original ?? '', current ?? '', '', '', { context: 3 });
    const lines = patch.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)).length;
    patches.push(patch);
    files.push(file);
    if (!isDocFile(file)) {
      codeLines += lines;
      codeFiles++;
    }
  }
  return { diff: patches.join('\n'), files, codeLines, codeFiles };
}

export function isRisky(diff: TurnDiff): boolean {
  return diff.codeFiles >= REVIEW_MIN_FILES || diff.codeLines >= REVIEW_MIN_LINES;
}

export const REVIEWER: SubagentDefinition = {
  name: 'reviewer',
  description: 'Reviews the changes of a turn before the agent concludes.',
  tools: ['read_file', 'outline_file', 'list_directory', 'search_files', 'glob'],
  maxTurns: 12,
  prompt: 'You are a strict, read-only code reviewer. Never modify files.',
  scope: 'built-in',
};

export function reviewPrompt(request: string, diff: TurnDiff, answer: string): string {
  const body = diff.diff.length > MAX_DIFF ? `${diff.diff.slice(0, MAX_DIFF)}\n[diff cut: ${diff.diff.length - MAX_DIFF} more characters; read the files for the rest]` : diff.diff;
  return `Another coding agent worked on this request from the user:
<request>
${request.slice(0, 4000)}
</request>

It changed ${diff.files.length} file${diff.files.length === 1 ? '' : 's'}:
<diff>
${body}
</diff>

Its final answer to the user:
<answer>
${answer.slice(0, 3000)}
</answer>

Review the changes against the request. Report only concrete defects: a requirement of the request not met, a bug, a caller, import or test left inconsistent, leftover debug code, or a claim in the answer that the code contradicts. Read the surrounding code when you need to confirm a problem. Do not report style preferences or optional improvements.

When the diff changes what a function takes or returns (its parameters, their meaning, its result), search its references and read every call site, including those outside the diff: a caller left on the old contract is a defect.

Reply with one line per defect: \`path:line — problem — why it matters\`. If you find no defect, end with a line \`Checked: <the call sites and files you verified>\` and then exactly: NO_ISSUES. If you could not verify something that matters (a call site you could not read, a file you ran out of turns for), reply \`INCOMPLETE: <what was not verified>\` instead of NO_ISSUES.`;
}

export type ReviewVerdict =
  | { status: 'clean' }
  | { status: 'issues'; text: string }
  /** The reviewer said what it could not verify: no green light. */
  | { status: 'incomplete'; text: string }
  | { status: 'inconclusive' };

const INCOMPLETE = /^[\s`*_]*INCOMPLETE[\s`*_]*:\s*(.+)$/m;

/**
 * A defect line: `path:line — problem`, as asked, or the usual variants a model writes (a list
 * marker, the location in backticks or bold, a colon or a dash after it).
 */
const DEFECT = /^\s*(?:[-*•]|\d+[.)])?\s*(?:\*\*|__|`)?[^\s`*]+:\d+(?:[-–]\d+)?(?:\*\*|__|`)?\s*(?:[—–:-]\s*)?\S/m;
/** NO_ISSUES as the whole reply, its last line, or its closing sentence ("No defect found. NO_ISSUES"). */
const CLEAN = /(?:^|\n|[.!]\s+)[\s`*_]*NO_ISSUES[\s`*_.]*$/;

/** Only an explicit verdict counts as a completed review. */
export function parseReview(text: string): ReviewVerdict {
  const t = text.trim();
  // The call sites listed under "Checked:" look like defect lines (path:line): they are not.
  const lines = t.split('\n');
  const checked = lines.findIndex((line) => /^[\s`*_]*Checked\s*:/.test(line));
  const defects = DEFECT.test(checked >= 0 ? lines.slice(0, checked).join('\n') : t);
  const incomplete = t.match(INCOMPLETE);
  if (!defects && incomplete) return { status: 'incomplete', text: incomplete[1].trim().slice(0, 2000) };
  if (!defects && CLEAN.test(t)) return { status: 'clean' };
  if (!defects) return { status: 'inconclusive' };
  return { status: 'issues', text: t.length > 4000 ? `${t.slice(0, 4000)}\n[review cut]` : t };
}
