import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';

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
    if (line.startsWith('+')) { current.lines.push({ type: 'add', text: line.slice(1), newNo: newNo++ }); additions++; }
    else if (line.startsWith('-')) { current.lines.push({ type: 'del', text: line.slice(1), oldNo: oldNo++ }); removals++; }
    else { current.lines.push({ type: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ }); }
  }
  return { file, hunks, additions, removals };
}

export const DiffView: React.FC<{ diff: string; maxLines?: number; showFile?: boolean }> = ({ diff, maxLines = 40, showFile = false }) => {
  const theme = useTheme();
  const parsed = parseUnifiedDiff(diff);
  const all: Array<DiffLine | { type: 'sep' }> = [];
  parsed.hunks.forEach((h, i) => {
    if (i > 0) all.push({ type: 'sep' });
    all.push(...h.lines);
  });
  const shown = all.slice(0, maxLines);
  const hidden = all.length - shown.length;
  const width = String(Math.max(...parsed.hunks.flatMap((h) => h.lines.map((l) => Math.max(l.oldNo ?? 0, l.newNo ?? 0))), 1)).length;
  return (
    <Box flexDirection="column">
      {showFile && parsed.file ? (
        <Text bold>{parsed.file} <Text color={theme.subtle}>(+{parsed.additions} −{parsed.removals})</Text></Text>
      ) : null}
      {shown.map((l, i) => {
        if (l.type === 'sep') return <Text key={i} color={theme.subtle}>{'  ' + '·'.repeat(3)}</Text>;
        const no = l.type === 'add' ? l.newNo : l.oldNo;
        const sign = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
        const color = l.type === 'add' ? theme.diffAdded : l.type === 'del' ? theme.diffRemoved : undefined;
        const bg = l.type === 'add' ? theme.diffAddedBg : l.type === 'del' ? theme.diffRemovedBg : undefined;
        return (
          <Box key={i}>
            <Text color={theme.subtle}>{String(no ?? '').padStart(width, ' ')} </Text>
            <Text color={color} backgroundColor={bg} dimColor={l.type === 'ctx'}>
              {sign} {l.text.replace(/\t/g, '  ') || ' '}
            </Text>
          </Box>
        );
      })}
      {hidden > 0 ? <Text color={theme.subtle}>… +{hidden} lines{maxLines >= 2000 ? '' : ' (ctrl+o to expand in the transcript)'}</Text> : null}
    </Box>
  );
};

export function diffStats(diff: string): { additions: number; removals: number } {
  const p = parseUnifiedDiff(diff);
  return { additions: p.additions, removals: p.removals };
}
