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
  tools: ['read_file', 'list_directory', 'search_files', 'glob'],
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

Reply with one line per defect: \`path:line — problem — why it matters\`. If you find no defect, reply exactly: NO_ISSUES`;
}

/** The defects found, or null when the reviewer found none (or said nothing usable). */
export function parseReview(text: string): string | null {
  const t = text.trim();
  if (!t || t === '(the subagent returned no text)') return null;
  if (/^[\s`*_]*NO_ISSUES[\s`*_.]*$/.test(t)) return null;
  // Defects come as `path:line — …`: a reply that says NO_ISSUES and names none is clean.
  if (/NO_ISSUES/.test(t) && !/\S+:\d+/.test(t)) return null;
  return t.length > 4000 ? `${t.slice(0, 4000)}\n[review cut]` : t;
}
