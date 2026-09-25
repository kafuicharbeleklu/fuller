import React from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import { useTheme } from './theme.js';
import { DiffRow, diffRows, type DiffRowLine } from './DiffView.js';
import type { FileDiff } from './gitDiff.js';

export interface DiffPanelState {
  /** Files the agent changed in this session. */
  files: FileDiff[];
  /** Other changed files ("+2 files edited before this session"). */
  others: FileDiff[];
  showOthers: boolean;
  /** While the changes are read. */
  loading?: boolean;
  /** First body row shown (the mouse wheel scrolls the panel). */
  scroll?: number;
}

interface Props extends DiffPanelState {
  width: number;
  height: number;
}

/** Claude Code's panel background and diff stat colours. */
const PANEL_BG = '#262626';
const STAT_ADDED = '#38a660';
const STAT_REMOVED = '#b3596b';
/** Rows above the body (a blank and the header with ✕) and below it (the "(show)" link and a blank). */
const TOP = 2;
const BOTTOM = 2;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const statText = (f: { additions: number; removals: number }) => `+${f.additions} -${f.removals}`;

type Row =
  | { kind: 'blank' }
  | { kind: 'empty'; text: string }
  | { kind: 'toggle'; text: string }
  | { kind: 'item'; file: FileDiff; target: number }
  | { kind: 'rule' }
  | { kind: 'title'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'diff'; line: DiffRowLine; numberWidth: number }
  | { kind: 'more'; hidden: number };

/**
 * The panel's body as rows: the file list, then each file between two rules with its diff (a new
 * file has no line counts in git until added: Claude Code says so instead). With the earlier
 * changes shown and none from this session, "No changes this session" and the "(hide)" link come
 * first, as in Claude Code 2.1.282. Each list row knows the row where its file's section starts.
 */
export function panelRows(state: DiffPanelState, width: number): { rows: Row[]; togglesInBody: boolean } {
  const { files, others, showOthers, loading } = state;
  const inner = Math.max(10, width - 2);
  const rows: Row[] = [];
  const group = (list: FileDiff[]) => {
    const items: Array<Extract<Row, { kind: 'item' }>> = list.map((file) => ({ kind: 'item', file, target: 0 }));
    rows.push(...items);
    list.forEach((f, i) => {
      items[i].target = rows.length;
      rows.push({ kind: 'rule' }, { kind: 'title', text: f.untracked ? `${f.file} (untracked)` : f.file }, { kind: 'rule' });
      if (f.untracked) {
        rows.push({ kind: 'note', text: 'New file not yet staged.' });
        for (const text of wrapAnsi(`Run \`git add :/${f.file}\` to see line counts.`, inner, { hard: true }).split('\n')) rows.push({ kind: 'note', text });
      } else {
        const { rows: lines, hidden, numberWidth } = diffRows(f.diff);
        for (const line of lines) rows.push({ kind: 'diff', line, numberWidth });
        if (hidden) rows.push({ kind: 'more', hidden });
      }
    });
  };
  const othersOnTop = showOthers && files.length === 0 && others.length > 0 && !loading;
  if (othersOnTop) {
    rows.push({ kind: 'blank' }, { kind: 'empty', text: 'No changes this session' }, { kind: 'blank' });
    rows.push({ kind: 'toggle', text: toggleText(others.length, true) }, { kind: 'blank' });
    group(others);
  } else if (files.length) {
    rows.push({ kind: 'blank' });
    group(files);
    if (showOthers && others.length) { rows.push({ kind: 'blank' }); group(others); }
  }
  return { rows, togglesInBody: othersOnTop };
}

function toggleText(count: number, shown: boolean): string {
  return count ? `+${plural(count, 'file')} edited before this session (${shown ? 'hide' : 'show'})` : '';
}

function bodyHeight(height: number): number {
  return Math.max(1, height - TOP - BOTTOM);
}

/** The furthest the body can scroll. */
export function maxPanelScroll(state: DiffPanelState, width: number, height: number): number {
  return Math.max(0, panelRows(state, width).rows.length - bodyHeight(height));
}

/** What a click at `row` (0 = the panel's first row) and `col` does: close, show/hide the earlier changes, or jump to a file. */
export function diffPanelClick(state: DiffPanelState, width: number, height: number, row: number, col: number): { close: true } | { toggle: true } | { scroll: number } | null {
  if (row === 1 && col >= width - 2) return { close: true };
  const { rows, togglesInBody } = panelRows(state, width);
  if (!togglesInBody && row === height - BOTTOM && state.others.length) return { toggle: true };
  const index = (state.scroll ?? 0) + row - TOP;
  if (row < TOP || row >= height - BOTTOM || index < 0 || index >= rows.length) return null;
  const hit = rows[index];
  if (hit.kind === 'toggle') return { toggle: true };
  if (hit.kind === 'item') return { scroll: Math.min(hit.target, maxPanelScroll(state, width, height)) };
  return null;
}

/**
 * /diff at 110 columns or more, as Claude Code shows it: a panel on the right of the conversation,
 * on a dark background, with "N files changed +A -D" and ✕, the file list, then each file's diff.
 * Changes made before the session are counted at the bottom ("(show)" adds them). The body
 * scrolls with the mouse wheel; a click on a file jumps to its diff.
 */
export const DiffPanel: React.FC<Props> = (props) => {
  const { files, others, showOthers, loading = false, width, height } = props;
  const theme = useTheme();
  const inner = Math.max(10, width - 2);
  const line = (key: string, content: React.ReactNode, used: number) => (
    // Ink boxes shrink by default: each row keeps its height and the body clips instead.
    <Box key={key} flexShrink={0}><Text backgroundColor={PANEL_BG} wrap="truncate-end"> {content}{' '.repeat(Math.max(0, inner - used))} </Text></Box>
  );
  const blank = (key: string) => line(key, '', 0);
  // The header counts this session's changes; the earlier ones are only listed.
  const additions = files.reduce((sum, f) => sum + f.additions, 0);
  const removals = files.reduce((sum, f) => sum + f.removals, 0);
  const stat = (a: number, r: number) => <><Text color={STAT_ADDED}>+{a}</Text> <Text color={STAT_REMOVED}>-{r}</Text></>;
  const header = files.length ? `${plural(files.length, 'file')} changed ` : '';

  const { rows, togglesInBody } = panelRows(props, width);
  const visible = bodyHeight(height);
  const scroll = Math.max(0, Math.min(props.scroll ?? 0, rows.length - visible));
  const render = (row: Row, key: string): React.ReactNode => {
    switch (row.kind) {
      case 'blank': return blank(key);
      case 'empty':
      case 'toggle':
      case 'note': return line(key, <Text color={theme.subtle}>{row.text}</Text>, stringWidth(row.text));
      case 'rule': return line(key, <Text color={theme.subtle}>{'─'.repeat(inner)}</Text>, inner);
      case 'title': return line(key, <Text bold>{row.text}</Text>, stringWidth(row.text));
      case 'item': {
        const f = row.file;
        const s = f.untracked ? 0 : statText(f).length;
        const room = inner - (s ? s + 1 : 0);
        const name = stringWidth(f.file) > room ? `…${f.file.slice(-(room - 1))}` : f.file;
        return line(key, <><Text color={theme.subtle}>{name}</Text>{s ? <>{' '.repeat(Math.max(1, inner - stringWidth(name) - s))}{stat(f.additions, f.removals)}</> : null}</>, s ? inner : stringWidth(name));
      }
      case 'diff': return (
        <Box key={key} flexShrink={0}>
          <Text backgroundColor={PANEL_BG}> </Text>
          <DiffRow line={row.line} numberWidth={row.numberWidth} width={inner} background={PANEL_BG} />
          <Text backgroundColor={PANEL_BG}> </Text>
        </Box>
      );
      case 'more': return line(key, <Text color={theme.subtle}>… +{row.hidden} lines</Text>, `… +${row.hidden} lines`.length);
    }
  };

  const empty = loading ? '' : 'No changes this session';
  const footerText = toggleText(others.length, showOthers);
  const middle = Math.max(0, Math.floor(height / 2) - TOP);
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {blank('top')}
      {line('header', <>
        {files.length ? <><Text bold>{header}</Text>{stat(additions, removals)}</> : null}
        {' '.repeat(Math.max(0, inner - stringWidth(header) - (files.length ? statText({ additions, removals }).length : 0) - 1))}
        <Text color={theme.subtle}>✕</Text>
      </>, inner)}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {rows.length ? rows.slice(scroll, scroll + visible).map((row, i) => render(row, `r${scroll + i}`)) : (
          <>
            {Array.from({ length: middle }, (_, i) => blank(`pad-${i}`))}
            {line('empty', <Text color={theme.subtle}>{' '.repeat(Math.max(0, Math.floor((inner - empty.length) / 2)))}{empty}</Text>, Math.max(0, Math.floor((inner - empty.length) / 2)) + empty.length)}
          </>
        )}
        {Array.from({ length: height }, (_, i) => blank(`fill-${i}`))}
      </Box>
      {togglesInBody ? blank('footer') : line('footer', <Text color={theme.subtle}>{footerText}</Text>, stringWidth(footerText))}
      {blank('bottom')}
    </Box>
  );
};
