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
export const DiffView: React.FC<{ diff: string; maxLines?: number; showFile?: boolean; language?: string; width?: number; background?: string }> = ({ diff, maxLines = 40, showFile = false, language, width, background }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const rowWidth = Math.max(10, width ?? (stdout?.columns ?? 80));
  const highlightLines = language !== undefined && theme.syntaxHighlighting !== false;
  const parsed = parseUnifiedDiff(diff);
  const all: Array<DiffLine | { type: 'sep' }> = [];
  parsed.hunks.forEach((h, i) => {
    if (i > 0) all.push({ type: 'sep' });
    all.push(...h.lines);
  });
  const shown = all.slice(0, maxLines);
  const hidden = all.length - shown.length;
  const numberWidth = String(Math.max(...parsed.hunks.flatMap((h) => h.lines.map((l) => Math.max(l.oldNo ?? 0, l.newNo ?? 0))), 1)).length;
  return (
    <Box flexDirection="column">
      {showFile && parsed.file ? (
        <Text bold>{parsed.file} <Text color={theme.subtle}>(+{parsed.additions} −{parsed.removals})</Text></Text>
      ) : null}
      {shown.map((l, i) => {
        if (l.type === 'sep') return <Text key={i} color={theme.subtle} backgroundColor={background}>{`${' '.repeat(numberWidth + 1)}…`.padEnd(background ? rowWidth : 0)}</Text>;
        const no = String((l.type === 'add' ? l.newNo : l.oldNo) ?? '').padStart(numberWidth, ' ');
        const sign = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
        const color = l.type === 'add' ? theme.diffAdded : l.type === 'del' ? theme.diffRemoved : theme.subtle;
        const bg = l.type === 'add' ? theme.diffAddedBg : l.type === 'del' ? theme.diffRemovedBg : background;
        const text = l.text.replace(/\t/g, '  ');
        const prefix = ` ${no} ${sign}`;
        const pad = Math.max(0, rowWidth - stringWidth(prefix) - stringWidth(text));
        return (
          <Text key={i} backgroundColor={bg} wrap="truncate-end">
            <Text color={color}>{prefix}</Text>
            <Text color={l.type === 'ctx' ? undefined : theme.text} dimColor={l.type === 'ctx'}>{highlightLines ? highlightCode(text, language) : text}</Text>
            {bg ? ' '.repeat(pad) : ''}
          </Text>
        );
      })}
      {hidden > 0 ? <Text color={theme.subtle}>… +{hidden} lines{maxLines >= 2000 ? '' : ' (ctrl+o to expand)'}</Text> : null}
    </Box>
  );
};

export function diffStats(diff: string): { additions: number; removals: number } {
  const p = parseUnifiedDiff(diff);
  return { additions: p.additions, removals: p.removals };
}
