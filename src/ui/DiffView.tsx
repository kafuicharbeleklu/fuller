import React from 'react';
import { Box, Text, useStdout } from 'ink';
import stringWidth from 'string-width';
import { useTheme } from './theme.js';
import { highlightCode } from './Markdown.js';

export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  text: string;
  oldNo?: number;
  newNo?: number;
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
  const color = l.type === 'add' ? theme.diffAdded : l.type === 'del' ? theme.diffRemoved : theme.subtle;
  const bg = l.type === 'add' ? theme.diffAddedBg : l.type === 'del' ? theme.diffRemovedBg : background;
  const text = l.text.replace(/\t/g, '  ');
  const prefix = ` ${no} ${sign}`;
  const pad = Math.max(0, rowWidth - stringWidth(prefix) - stringWidth(text));
  return (
    <Text backgroundColor={bg} wrap="truncate-end">
      <Text color={color}>{prefix}</Text>
      <Text color={l.type === 'ctx' ? undefined : theme.text} dimColor={l.type === 'ctx'}>{highlightLines ? highlightCode(text, language) : text}</Text>
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
