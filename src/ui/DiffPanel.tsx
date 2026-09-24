import React from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { useTheme } from './theme.js';
import { DiffView } from './DiffView.js';
import type { FileDiff } from './gitDiff.js';

interface Props {
  /** Files the agent changed in this session. */
  files: FileDiff[];
  /** Other changed files ("+2 files edited before this session"). */
  others: FileDiff[];
  showOthers: boolean;
  /** While the changes are read. */
  loading?: boolean;
  width: number;
  height: number;
}

/** Claude Code's panel background and diff stat colours. */
const PANEL_BG = '#262626';
const STAT_ADDED = '#38a660';
const STAT_REMOVED = '#b3596b';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The panel's rows (row 1 is the header with ✕, the second last the "(show)" link), for mouse hits. */
export function diffPanelHits(height: number, width: number): { closeRow: number; closeCol: number; showRow: number } {
  return { closeRow: 1, closeCol: width - 1, showRow: height - 2 };
}

/**
 * /diff at 110 columns or more, as Claude Code 2.1.281 shows it: a panel on
 * the right of the conversation, on a dark background, with "N files changed
 * +A -D" and ✕, the file list, then each file's diff. Changes made before the
 * session are counted at the bottom ("(show)" adds them).
 */
export const DiffPanel: React.FC<Props> = ({ files, others, showOthers, loading = false, width, height }) => {
  const theme = useTheme();
  const shown = showOthers ? [...files, ...others] : files;
  const inner = Math.max(10, width - 2);
  const line = (key: string, content: React.ReactNode, used: number) => (
    // Ink boxes shrink by default: each row keeps its height and the body clips instead.
    <Box key={key} flexShrink={0}><Text backgroundColor={PANEL_BG} wrap="truncate-end"> {content}{' '.repeat(Math.max(0, inner - used))} </Text></Box>
  );
  const blank = (key: string) => line(key, '', 0);
  const additions = shown.reduce((sum, f) => sum + f.additions, 0);
  const removals = shown.reduce((sum, f) => sum + f.removals, 0);
  const stat = (a: number, r: number) => <><Text color={STAT_ADDED}>+{a}</Text> <Text color={STAT_REMOVED}>-{r}</Text></>;
  const statWidth = (a: number, r: number) => `+${a} -${r}`.length;
  const footerText = others.length
    ? `+${plural(others.length, 'file')} edited before this session (${showOthers ? 'hide' : 'show'})`
    : '';

  const header = shown.length ? `${plural(shown.length, 'file')} changed ` : '';
  const top: React.ReactNode[] = [
    blank('top'),
    line('header', <>
      {shown.length ? <><Text bold>{header}</Text>{stat(additions, removals)}</> : null}
      {' '.repeat(Math.max(0, inner - stringWidth(header) - (shown.length ? statWidth(additions, removals) : 0) - 1))}
      <Text color={theme.subtle}>✕</Text>
    </>, inner),
  ];

  const body: React.ReactNode[] = [];
  if (shown.length) {
    body.push(blank('gap'));
    for (const f of shown) {
      const s = statWidth(f.additions, f.removals);
      const name = stringWidth(f.file) > inner - s - 1 ? `…${f.file.slice(-(inner - s - 2))}` : f.file;
      body.push(line(`list-${f.file}`, <><Text color={theme.subtle}>{name}</Text>{' '.repeat(Math.max(1, inner - stringWidth(name) - s))}{stat(f.additions, f.removals)}</>, inner));
    }
    for (const f of shown) {
      body.push(line(`rule1-${f.file}`, <Text color={theme.subtle}>{'─'.repeat(inner)}</Text>, inner));
      body.push(line(`name-${f.file}`, <Text bold>{f.file}</Text>, stringWidth(f.file)));
      body.push(line(`rule2-${f.file}`, <Text color={theme.subtle}>{'─'.repeat(inner)}</Text>, inner));
      body.push(
        <Box key={`diff-${f.file}`} flexShrink={0}>
          <Text backgroundColor={PANEL_BG}> </Text>
          <DiffView diff={f.diff} maxLines={2000} width={inner} background={PANEL_BG} />
          <Text backgroundColor={PANEL_BG}> </Text>
        </Box>,
      );
    }
  }

  const empty = loading ? '' : 'No changes this session';
  const middle = Math.max(0, Math.floor(height / 2) - top.length);
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {top}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {shown.length ? body : (
          <>
            {Array.from({ length: middle }, (_, i) => blank(`pad-${i}`))}
            {line('empty', <Text color={theme.subtle}>{' '.repeat(Math.max(0, Math.floor((inner - empty.length) / 2)))}{empty}</Text>, Math.max(0, Math.floor((inner - empty.length) / 2)) + empty.length)}
          </>
        )}
        {Array.from({ length: height }, (_, i) => blank(`fill-${i}`))}
      </Box>
      {line('footer', <Text color={theme.subtle}>{footerText}</Text>, stringWidth(footerText))}
      {blank('bottom')}
    </Box>
  );
};
