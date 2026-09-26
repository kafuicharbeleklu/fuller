import React from 'react';
import { Box, Text, useStdout } from 'ink';
import stringWidth from 'string-width';
import { useTheme } from './theme.js';
import { highlightCode, syntaxPalette } from './Markdown.js';

export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  text: string;
  oldNo?: number;
  newNo?: number;
  /** The characters that changed from the paired removed/added line: [start, end) in `text`. */
  changed?: [number, number];
}

/**
 * The part of a modified line that changed, by words: what is left once the words both lines start
 * and end with are set aside. None when the lines have nothing in common (a rewritten line).
 */
export function changedWords(before: string, after: string): { removed: [number, number]; added: [number, number] } | null {
  const tokens = (text: string) => text.match(/\w+|\s+|[^\w\s]/g) ?? [];
  const a = tokens(before), b = tokens(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  if (head === 0 && tail === 0) return null;
  const span = (list: string[]) => {
    const start = list.slice(0, head).join('').length;
    const end = list.join('').length - list.slice(list.length - tail).join('').length;
    return [start, end] as [number, number];
  };
  const removed = span(a), added = span(b);
  if (removed[0] === removed[1] && added[0] === added[1]) return null;
  return { removed, added };
}

/** Pair each run of removed lines with the added lines that follow, one for one, and mark their changed words. */
function markChangedWords(lines: DiffLine[]): void {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== 'del') continue;
    let j = i;
    while (j < lines.length && lines[j].type === 'del') j++;
    let k = j;
    while (k < lines.length && lines[k].type === 'add') k++;
    if (k - j === j - i) {
      for (let n = 0; n < j - i; n++) {
        const words = changedWords(lines[i + n].text, lines[j + n].text);
        if (!words) continue;
        lines[i + n].changed = words.removed;
        lines[j + n].changed = words.added;
      }
    }
    i = k - 1;
  }
}

/** Put a background under the characters [start, end) of a string that may hold colour codes. */
export function backgroundRange(text: string, start: number, end: number, color: string): string {
  const m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m || start >= end) return text;
  const open = `\x1b[48;2;${parseInt(m[1], 16)};${parseInt(m[2], 16)};${parseInt(m[3], 16)}m`;
  // \x1b[49m: the row's own background comes back (chalk re-opens it inside the row's colour).
  const close = '\x1b[49m';
  let out = '';
  let visible = 0;
  for (let i = 0; i < text.length;) {
    const escape = text.slice(i).match(/^\x1b\[[0-9;]*m/);
    if (escape) { out += escape[0]; i += escape[0].length; continue; }
    if (visible === start) out += open;
    out += text[i];
    visible++;
    i++;
    if (visible === end) out += close;
  }
  return out;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface ParsedDiff {
  file: string;
  hunks: DiffHunk[];
  additions: number;
  removals: number;
}

export function parseUnifiedDiff(diff: string): ParsedDiff {
  const lines = diff.split('\n');
  let file = '';
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let additions = 0;
  let removals = 0;
  for (const line of lines) {
    if (line.startsWith('+++ ')) { file = line.slice(4).replace(/^b\//, '').trim(); continue; }
    if (line.startsWith('--- ') || line.startsWith('Index:') || line.startsWith('===')) continue;
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (h) {
      oldNo = parseInt(h[1], 10);
      newNo = parseInt(h[2], 10);
      current = { header: line, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('\\')) continue;
    // The newline that ends the patch text is not a context line (real ones start with a space).
    if (line === '') continue;
    if (line.startsWith('+')) { current.lines.push({ type: 'add', text: line.slice(1), newNo: newNo++ }); additions++; }
    else if (line.startsWith('-')) { current.lines.push({ type: 'del', text: line.slice(1), oldNo: oldNo++ }); removals++; }
    else { current.lines.push({ type: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ }); }
  }
  return { file, hunks, additions, removals };
}

/**
 * Claude Code 2.1.281 diff rows: " 12 -text", the line number and sign in the
 * diff colour, the text in the normal colour, and the row background drawn
 * across the whole available width.
 */
export type DiffRowLine = DiffLine | { type: 'sep' };

/** A diff as display rows, one per line (a "…" row between hunks), for views that place rows themselves. */
export function diffRows(diff: string, maxLines = 2000): { rows: DiffRowLine[]; hidden: number; numberWidth: number; parsed: ParsedDiff } {
  const parsed = parseUnifiedDiff(diff);
  const all: DiffRowLine[] = [];
  parsed.hunks.forEach((h, i) => {
    if (i > 0) all.push({ type: 'sep' });
    markChangedWords(h.lines);
    all.push(...h.lines);
  });
  const numberWidth = String(Math.max(...parsed.hunks.flatMap((h) => h.lines.map((l) => Math.max(l.oldNo ?? 0, l.newNo ?? 0))), 1)).length;
  return { rows: all.slice(0, maxLines), hidden: Math.max(0, all.length - maxLines), numberWidth, parsed };
}

/** One diff row: line number, sign, text, on the add/remove background. */
export const DiffRow: React.FC<{ line: DiffRowLine; numberWidth: number; width: number; background?: string; language?: string }> = ({ line: l, numberWidth, width: rowWidth, background, language }) => {
  const theme = useTheme();
  if (l.type === 'sep') return <Text color={theme.subtle} backgroundColor={background}>{`${' '.repeat(numberWidth + 1)}…`.padEnd(background ? rowWidth : 0)}</Text>;
  const highlightLines = language !== undefined && theme.syntaxHighlighting !== false;
  // Removed lines keep their old number; added and context lines show the new file's, as Claude Code does.
  const no = String((l.type === 'del' ? l.oldNo : l.newNo) ?? '').padStart(numberWidth, ' ');
  const sign = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
  const bg = l.type === 'add' ? theme.diffAddedBg : l.type === 'del' ? theme.diffRemovedBg : background;
  // Tabs as two spaces: the changed range moves with them.
  const tabsBefore = (end: number) => (l.text.slice(0, end).match(/\t/g) ?? []).length;
  const text = l.text.replace(/\t/g, '  ');
  const prefix = ` ${no} ${sign}`;
  const pad = Math.max(0, rowWidth - stringWidth(prefix) - stringWidth(text));
  const monokai = syntaxPalette(theme.name) === 'monokai';
  // Claude Code 2.1.283: removed lines in plain text, added and context lines coloured; the context
  // line number dimmed; the words that changed on a brighter background.
  let body = l.type !== 'del' && highlightLines ? highlightCode(text, language, syntaxPalette(theme.name)) : text;
  const wordBg = l.type === 'add' ? theme.diffAddedWordBg : l.type === 'del' ? theme.diffRemovedWordBg : undefined;
  if (l.changed && wordBg) body = backgroundRange(body, l.changed[0] + tabsBefore(l.changed[0]), l.changed[1] + tabsBefore(l.changed[1]), wordBg);
  return (
    <Text backgroundColor={bg} wrap="truncate-end">
      {l.type === 'ctx' ? <Text color={monokai ? '#f8f8f2' : undefined} dimColor>{prefix}</Text> : <Text color={l.type === 'add' ? theme.diffAdded : theme.diffRemoved}>{prefix}</Text>}
      <Text color={l.type === 'ctx' && highlightLines ? undefined : monokai ? '#f8f8f2' : theme.text}>{body}</Text>
      {bg ? ' '.repeat(pad) : ''}
    </Text>
  );
};

export const DiffView: React.FC<{ diff: string; maxLines?: number; showFile?: boolean; language?: string; width?: number; background?: string }> = ({ diff, maxLines = 40, showFile = false, language, width, background }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const rowWidth = Math.max(10, width ?? (stdout?.columns ?? 80));
  const { rows, hidden, numberWidth, parsed } = diffRows(diff, maxLines);
  return (
    <Box flexDirection="column">
      {showFile && parsed.file ? (
        <Text bold>{parsed.file} <Text color={theme.subtle}>(+{parsed.additions} −{parsed.removals})</Text></Text>
      ) : null}
      {rows.map((l, i) => <DiffRow key={i} line={l} numberWidth={numberWidth} width={rowWidth} background={background} language={language} />)}
      {hidden > 0 ? <Text color={theme.subtle}>… +{hidden} lines{maxLines >= 2000 ? '' : ' (ctrl+o to expand)'}</Text> : null}
    </Box>
  );
};

export function diffStats(diff: string): { additions: number; removals: number } {
  const p = parseUnifiedDiff(diff);
  return { additions: p.additions, removals: p.removals };
}
