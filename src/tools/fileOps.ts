import fs from 'node:fs/promises';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import type { CheckpointManager } from '../checkpoint/manager.js';
import { assertReadable, assertWritable, displayPath } from './paths.js';
import { LIMITS, formatBytes, isProbablyBinary } from './truncate.js';

export interface FileCtx {
  cwd: string;
  extraDirs?: string[];
  checkpointManager?: CheckpointManager;
  messageId?: string;
}

export interface ReadResult {
  content: string;
  totalLines: number;
  shownFrom: number;
  shownTo: number;
  truncated: boolean;
  summary: string;
}

export async function readFile(
  filePath: string,
  ctx: FileCtx,
  offset?: number,
  limit?: number
): Promise<ReadResult> {
  const fullPath = assertReadable(filePath, ctx.cwd, ctx.extraDirs);
  const stat = await fs.stat(fullPath);
  if (stat.isDirectory()) throw new Error(`"${filePath}" is a directory: use list_directory.`);
  if (stat.size > LIMITS.readBytes) {
    throw new Error(`File too large (${formatBytes(stat.size)}). Read it in ranges with offset/limit, or with execute_bash (head/sed).`);
  }
  const buf = await fs.readFile(fullPath);
  if (isProbablyBinary(buf)) {
    return { content: `[Binary file, ${formatBytes(stat.size)}]`, totalLines: 0, shownFrom: 0, shownTo: 0, truncated: false, summary: `Binary file (${formatBytes(stat.size)})` };
  }
  const lines = buf.toString('utf8').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const totalLines = lines.length;
  const start = Math.max(1, offset ?? 1) - 1;
  const max = Math.min(limit ?? LIMITS.readLines, LIMITS.readLines);
  const end = Math.min(totalLines, start + max);
  const slice = lines.slice(start, end);
  const width = String(end).length;
  const numbered = slice
    .map((line, idx) => {
      const l = line.length > LIMITS.lineChars ? line.slice(0, LIMITS.lineChars) + ' … [line truncated]' : line;
      return `${String(start + idx + 1).padStart(width, ' ')}\t${l}`;
    })
    .join('\n');
  const truncated = end < totalLines || start > 0;
  const content = truncated
    ? `${numbered}\n\n[PARTIAL view: lines ${start + 1}-${end} of ${totalLines}. Use offset/limit to read more.]`
    : numbered;
  return {
    content,
    totalLines,
    shownFrom: start + 1,
    shownTo: end,
    truncated,
    summary: truncated ? `Read ${end - start} lines (of ${totalLines})` : `Read ${totalLines} lines`,
  };
}

export interface WriteResult {
  path: string;
  bytesWritten: number;
  diff: string;
  additions: number;
  removals: number;
  created: boolean;
  summary: string;
  /** The file's content before the write ('' for a new file), for the differential syntax check. */
  previous: string;
}

function countChanges(patch: string): { additions: number; removals: number } {
  let additions = 0;
  let removals = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) removals++;
  }
  return { additions, removals };
}

export async function previewWrite(filePath: string, content: string, ctx: FileCtx): Promise<{ diff: string; created: boolean; additions: number; removals: number; previous: string }> {
  const fullPath = assertWritable(filePath, ctx.cwd, ctx.extraDirs);
  let existing = '';
  let created = true;
  try {
    existing = await fs.readFile(fullPath, 'utf8');
    created = false;
  } catch {}
  const rel = displayPath(fullPath, ctx.cwd);
  const diff = createTwoFilesPatch(rel, rel, existing, content, undefined, undefined, { context: 3 });
  return { diff, created, previous: existing, ...countChanges(diff) };
}

export async function writeFile(filePath: string, content: string, ctx: FileCtx): Promise<WriteResult> {
  const fullPath = assertWritable(filePath, ctx.cwd, ctx.extraDirs);
  const preview = await previewWrite(filePath, content, ctx);
  ctx.checkpointManager?.createCheckpoint(`write_file: ${filePath}`, [fullPath], ctx.messageId);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  const rel = displayPath(fullPath, ctx.cwd);
  const summary = preview.created
    ? `Wrote ${content.replace(/\n$/, '').split('\n').length} line${content.replace(/\n$/, '').split('\n').length === 1 ? '' : 's'} to ${rel}`
    : `Updated ${rel} with ${preview.additions} addition${preview.additions === 1 ? '' : 's'} and ${preview.removals} removal${preview.removals === 1 ? '' : 's'}`;
  return { path: rel, bytesWritten: Buffer.byteLength(content, 'utf8'), ...preview, summary };
}

export interface EditPreview {
  fullPath: string;
  rel: string;
  updated: string;
  diff: string;
  additions: number;
  removals: number;
  occurrences: number;
  /** The exact text was not there; one place matched once indentation and trailing spaces were ignored. */
  loose: boolean;
  /** What was really replaced (the file's own lines when the match was loose). */
  matched: string;
  /** What was really written (re-indented like the file when the match was loose). */
  written: string;
  /** The file before the edit, for the differential syntax check. */
  previous: string;
}

/** A line the model left as a stand-in for code it did not write: `// ... rest of the code`, `# ... existing code ...`. */
const PLACEHOLDER_LINE = /^\s*(?:\/\/|#|\/\*|<!--|--)?\s*(?:\.\.\.|…)\s*(?:rest|existing|unchanged|remaining|same|other|previous|original|more)\b/i;

export function hasPlaceholder(text: string): boolean {
  return text.split('\n').some((line) => PLACEHOLDER_LINE.test(line));
}

const leadingSpace = (line: string) => line.match(/^[ \t]*/)![0];

/** Re-indent `replacement` (written for `givenIndent`) the way the file is indented (`actualIndent`). */
function reindent(replacement: string, givenIndent: string, actualIndent: string): string {
  if (givenIndent === actualIndent) return replacement;
  return replacement
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line;
      if (line.startsWith(givenIndent)) return actualIndent + line.slice(givenIndent.length);
      return line;
    })
    .join('\n');
}

/**
 * The target, matched line by line with leading and trailing whitespace ignored (Gemini CLI's
 * first fallback, the only one Fuller uses: a fuzzy match can change the wrong function).
 */
function looseMatches(rawLines: string[], target: string): number[] {
  const wanted = target.replace(/\n$/, '').split('\n').map((l) => l.trim());
  if (wanted.length === 0 || wanted.every((l) => l === '')) return [];
  const starts: number[] = [];
  for (let i = 0; i + wanted.length <= rawLines.length; i++) {
    let ok = true;
    for (let j = 0; j < wanted.length; j++) {
      if (rawLines[i + j].trim() !== wanted[j]) { ok = false; break; }
    }
    if (ok) starts.push(i);
  }
  return starts;
}

/** Lines that look like the target's first line, for the "not found" error. */
function candidateLines(rawLines: string[], target: string): string[] {
  const first = target.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (!first) return [];
  const exact = rawLines.map((l, i) => (l.trim() === first ? i : -1)).filter((i) => i >= 0);
  const found = exact.length ? exact : first.length >= 8 ? rawLines.map((l, i) => (l.includes(first) ? i : -1)).filter((i) => i >= 0) : [];
  return found.slice(0, 5).map((i) => `  ${i + 1}: ${rawLines[i].trim().slice(0, 120)}`);
}

export async function previewEdit(
  filePath: string,
  target: string,
  replacement: string,
  ctx: FileCtx,
  replaceAll = false
): Promise<EditPreview> {
  const fullPath = assertWritable(filePath, ctx.cwd, ctx.extraDirs);
  let raw: string;
  try {
    raw = await fs.readFile(fullPath, 'utf8');
  } catch {
    throw new Error(`File not found: ${filePath}. Use write_file to create a new file.`);
  }
  if (typeof target !== 'string' || target.length === 0) throw new Error('target_content must not be empty.');
  if (typeof replacement !== 'string') throw new Error('replacement_content is required (an empty string deletes the target).');
  if (target === replacement) throw new Error('target_content and replacement_content are identical: nothing to change.');
  if (hasPlaceholder(replacement) && !hasPlaceholder(target)) {
    throw new Error('replacement_content contains a placeholder line ("... rest of the code"): it would be written as is. Write the full text that must end up in the file, or make a smaller edit around the lines that change.');
  }
  const rel = displayPath(fullPath, ctx.cwd);
  const occurrences = raw.split(target).length - 1;
  let updated: string;
  let loose = false;
  let matched = target;
  let written = replacement;
  if (occurrences === 0) {
    const rawLines = raw.split('\n');
    const starts = looseMatches(rawLines, target);
    if (starts.length === 1 && !replaceAll) {
      const count = target.replace(/\n$/, '').split('\n').length;
      const lines = rawLines.slice(starts[0], starts[0] + count);
      matched = lines.join('\n');
      written = reindent(replacement.replace(/\n$/, ''), leadingSpace(target), leadingSpace(lines[0]));
      updated = [...rawLines.slice(0, starts[0]), ...written.split('\n'), ...rawLines.slice(starts[0] + count)].join('\n');
      loose = true;
    } else if (starts.length > 0) {
      throw new Error(`target_content was not found exactly in ${filePath}, but ${starts.length} place${starts.length === 1 ? '' : 's'} match${starts.length === 1 ? 'es' : ''} it once indentation and trailing spaces are ignored (line${starts.length === 1 ? '' : 's'} ${starts.map((s) => s + 1).join(', ')}). Read the file there with read_file (offset/limit) and copy the exact text, indentation included.`);
    } else {
      const candidates = candidateLines(rawLines, target);
      throw new Error(candidates.length
        ? `target_content was not found in ${filePath}. Lines that look like its first line:\n${candidates.join('\n')}\nRead the file around them with read_file (offset/limit) and copy the exact text, spaces and indentation included.`
        : `target_content was not found in ${filePath}. Read the file again with read_file and copy the exact text, spaces and indentation included.`);
    }
  } else if (occurrences > 1 && !replaceAll) {
    throw new Error(`target_content appears ${occurrences} times in ${filePath}. Add surrounding context to make it unique, or pass replace_all=true.`);
  } else {
    updated = replaceAll ? raw.split(target).join(replacement) : raw.replace(target, () => replacement);
  }
  const diff = createTwoFilesPatch(rel, rel, raw, updated, undefined, undefined, { context: 3 });
  return { fullPath, rel, updated, diff, occurrences: loose ? 1 : occurrences, loose, matched, written, previous: raw, ...countChanges(diff) };
}

export async function editFile(
  filePath: string,
  target: string,
  replacement: string,
  ctx: FileCtx,
  replaceAll = false
): Promise<{ path: string; message: string; diff: string; summary: string; additions: number; removals: number; updated: string; previous: string }> {
  const preview = await previewEdit(filePath, target, replacement, ctx, replaceAll);
  ctx.checkpointManager?.createCheckpoint(`edit_file: ${filePath}`, [preview.fullPath], ctx.messageId);
  await fs.writeFile(preview.fullPath, preview.updated, 'utf8');
  const summary = `Updated ${preview.rel} with ${preview.additions} addition${preview.additions === 1 ? '' : 's'} and ${preview.removals} removal${preview.removals === 1 ? '' : 's'}`;
  const snippet = firstHunkSnippet(preview.updated, preview.written);
  const note = preview.loose ? ' (the exact text was not there: matched with indentation and trailing spaces ignored, and re-indented like the file)' : '';
  return {
    path: preview.rel,
    message: `${summary}${note}.${snippet ? `\nThe edited region now reads:\n${snippet}` : ''}`,
    diff: preview.diff,
    summary,
    additions: preview.additions,
    removals: preview.removals,
    updated: preview.updated,
    previous: preview.previous,
  };
}

function firstHunkSnippet(updated: string, replacement: string): string {
  const idx = updated.indexOf(replacement);
  if (idx === -1) return '';
  const before = updated.slice(0, idx).split('\n');
  const startLine = before.length;
  const lines = updated.split('\n');
  const from = Math.max(0, startLine - 3);
  const to = Math.min(lines.length, startLine + replacement.split('\n').length + 2);
  const width = String(to).length;
  return lines.slice(from, to).map((l, i) => `${String(from + i + 1).padStart(width, ' ')}\t${l}`).join('\n');
}

