import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import wrapAnsi from 'wrap-ansi';
import stripAnsi from 'strip-ansi';
import stringWidth from 'string-width';
import { ThemeProvider, useTheme } from './theme.js';
import { renderToString } from './renderToString.js';
import { TranscriptItemView } from './Transcript.js';
import { LiveArea } from './LiveArea.js';
import type { BannerProps } from './Banner.js';
import type { LiveTurn, TranscriptItem } from '../agent/types.js';
import { groupToolItems, ToolGroupRow } from './ToolGroup.js';

/** Word-aware wrapping that keeps ANSI colours; very long words are still cut. */
function wrapLine(line: string, width: number): string[] {
  if (!line) return [''];
  return wrapAnsi(line, width, { hard: true, trim: false }).split('\n');
}

interface RowsOptions {
  items: TranscriptItem[];
  live: LiveTurn | null;
  verbose: boolean;
  banner: BannerProps;
  frame: string;
  permissionOpen: boolean;
  width: number;
  /** Items opened with a click (tool results, tool groups, thinking), shown as in the detailed view. */
  expanded?: Set<string>;
}

/** The rendered rows, and for each the item a click on it opens or closes (null: not clickable). */
export interface TranscriptRows {
  lines: string[];
  owners: Array<string | null>;
  /** The user's prompts: the line each starts on and its text, for the sticky header. */
  prompts: Array<{ line: number; text: string }>;
  /** Committed items, counted for "N new messages". */
  itemCount: number;
}

/** Items a click expands: a tool result, a group of folded tools, a thought summary (Claude Code: click a collapsed tool result). */
const CLICKABLE = new Set(['tool', 'tool_group', 'thinking']);

/**
 * The fullscreen conversation drawn with the same components as the classic
 * renderer (Markdown, tool rows, colours), as Claude Code does in both modes.
 * Committed items are rendered once per width, verbosity and theme.
 */
export function useTranscriptRows({ items, live, verbose, banner, frame, permissionOpen, width, expanded }: RowsOptions): TranscriptRows {
  const theme = useTheme();
  const cache = useRef(new Map<string, string[]>());
  const [rows, setRows] = useState<TranscriptRows>({ lines: [], owners: [], prompts: [], itemCount: 0 });
  useEffect(() => {
    // renderToString mounts a separate Ink root. Inside React's render or commit
    // phase that nested render is deferred and yields nothing, so lay out the
    // rows from a fresh macrotask and store them.
    let cancelled = false;
    const handle = setImmediate(() => {
      if (cancelled) return;
      const prefix = `${width}|${verbose ? 1 : 0}|${theme.name}|${theme.syntaxHighlighting === false ? 0 : 1}|`;
      const next = new Map<string, string[]>();
      const out: string[] = [];
      const owners: Array<string | null> = [];
      const prompts: Array<{ line: number; text: string }> = [];
      const shown = verbose ? items : groupToolItems(items);
      for (const item of shown) {
        const open = !verbose && !!expanded?.has(item.key);
        const key = prefix + (open ? 'open|' : '') + item.key;
        let lines = cache.current.get(key);
        if (!lines) {
          const view = item.kind === 'tool_group'
            ? (open
              ? <>{item.tools.map((tool) => <TranscriptItemView key={tool.id} item={{ key: tool.id, kind: 'tool', messageId: '', toolCall: tool }} verbose banner={banner} />)}</>
              : <ToolGroupRow tools={item.tools} />)
            : <TranscriptItemView item={item} verbose={verbose || open} banner={banner} />;
          const text = renderToString(<ThemeProvider theme={theme}>{view}</ThemeProvider>, width, 1000, false);
          // Untrimmed: a trailing newline is a bottom margin (the banner's) and must stay a blank row.
          lines = text ? text.split('\n') : [];
        }
        next.set(key, lines);
        if (item.kind === 'user') {
          const first = lines.findIndex((line) => stripAnsi(line).trim() !== '');
          prompts.push({ line: out.length + Math.max(0, first), text: item.message.content.replace(/\s+/g, ' ').trim() });
        }
        out.push(...lines);
        const owner = !verbose && CLICKABLE.has(item.kind) ? item.key : null;
        for (let i = 0; i < lines.length; i++) owners.push(owner);
      }
      cache.current = next;
      if (live) {
        const text = renderToString(<ThemeProvider theme={theme}><LiveArea live={live} verbose={verbose} frame={frame} maxLines={100_000} permissionOpen={permissionOpen} /></ThemeProvider>, width, 1000);
        if (text) for (const line of text.split('\n')) { out.push(line); owners.push(null); }
      }
      setRows({ lines: out, owners, prompts, itemCount: shown.length });
    });
    return () => { cancelled = true; clearImmediate(handle); };
  }, [items, live, verbose, banner, frame, permissionOpen, theme, width, expanded]);
  return rows;
}

export type ScrollAction = 'up' | 'down' | 'lineUp' | 'lineDown' | 'top' | 'bottom';
interface Props {
  lines: string[];
  height: number;
  scrollRequest: { id: number; direction: ScrollAction };
  /** Narrower than the terminal when the /diff panel is open. */
  width?: number;
  /** The item each line belongs to, for clicks (see useTranscriptRows). */
  owners?: Array<string | null>;
  /** A click on the transcript's `row` (0 = its first visible row). */
  clickRequest?: { id: number; row: number };
  /** Open or close the clicked item. */
  onToggleItem?: (key: string) => void;
  /** The user's prompts (from useTranscriptRows): the one scrolled out above stays pinned on top. */
  prompts?: Array<{ line: number; text: string }>;
  /** Committed items: those added while scrolled up are counted on the pill. */
  itemCount?: number;
}

/** Text padded (or cut) to exactly `width` columns, for rows drawn on a background. */
function fit(text: string, width: number): string {
  let out = text;
  while (stringWidth(out) > width && out.length > 0) out = out.slice(0, -2) + '…';
  return out + ' '.repeat(Math.max(0, width - stringWidth(out)));
}

/**
 * The pill shown while scrolled up, as Claude Code 2.1.283 words it: "Jump to bottom (ctrl+end) ↓",
 * or "3 new messages (ctrl+end) ↓" when items arrived meanwhile; shorter forms on narrow screens.
 */
export function pillLabel(unseen: number, width: number): string {
  const head = unseen > 0 ? `${unseen} new ${unseen === 1 ? 'message' : 'messages'}` : 'Jump to bottom';
  return [`${head} (ctrl+end) ↓`, `${head} ↓`, head].find((label) => stringWidth(label) <= width - 2) ?? head;
}

/** Bounded alternate-screen transcript; native scrollback remains available in classic mode. */
export const FullscreenTranscript: React.FC<Props> = ({ lines, height, scrollRequest, width: fixedWidth, owners, clickRequest, onToggleItem, prompts = [], itemCount = 0 }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = Math.max(20, fixedWidth ?? (stdout.columns || 80));
  const { rows, rowOwners, lineStart } = useMemo(() => {
    const outRows: string[] = [];
    const outOwners: Array<string | null> = [];
    const starts: number[] = [];
    lines.forEach((line, i) => { starts.push(outRows.length); for (const part of wrapLine(line, width)) { outRows.push(part); outOwners.push(owners?.[i] ?? null); } });
    return { rows: outRows, rowOwners: outOwners, lineStart: starts };
  }, [lines, owners, width]);
  const [following, setFollowing] = useState(true);
  // Following from the first frame: start at the bottom rather than flash the oldest rows.
  const [top, setTop] = useState(() => Math.max(0, rows.length - height));
  // Claude Code, scrolled up: the last prompt above the view stays pinned on the first row (a click
  // goes back to it), and the last row offers the way down with the number of items that arrived since.
  const promptRows = useMemo(() => prompts.map((p) => ({ row: lineStart[p.line] ?? 0, text: p.text })), [prompts, lineStart]);
  const sticky = following ? null : [...promptRows].reverse().find((p) => p.row < top) ?? null;
  const [seen, setSeen] = useState(itemCount);
  useEffect(() => { if (following) setSeen(itemCount); }, [following, itemCount]);
  const unseen = following ? 0 : Math.max(0, itemCount - seen);
  const headerRows = sticky && height > 3 ? 1 : 0;
  const page = Math.max(1, height - (following ? 0 : 1) - headerRows);
  const maxTop = Math.max(0, rows.length - page);
  useEffect(() => { if (following) setTop(maxTop); else setTop((value) => Math.min(value, maxTop)); }, [maxTop, following]);
  useEffect(() => {
    if (!scrollRequest.id) return;
    const direction = scrollRequest.direction;
    const half = Math.max(1, Math.floor(page / 2));
    const delta = direction === 'up' ? -half : direction === 'down' ? half : direction === 'lineUp' ? -3 : 3;
    setTop((value) => {
      const next = direction === 'top' ? 0 : direction === 'bottom' ? maxTop : Math.max(0, Math.min(maxTop, value + delta));
      setFollowing(next >= maxTop);
      return next;
    });
  }, [scrollRequest.id]);
  useEffect(() => {
    if (!clickRequest?.id || clickRequest.row < 0) return;
    if (headerRows && sticky && clickRequest.row === 0) { setTop(sticky.row); return; }
    if (!following && clickRequest.row === height - 1) { setFollowing(true); return; }
    const row = clickRequest.row - headerRows;
    if (row < 0 || row >= page) return;
    const owner = rowOwners[top + row];
    if (owner) onToggleItem?.(owner);
  }, [clickRequest?.id]);
  const pill = pillLabel(unseen, width);
  return (
    <Box flexDirection="column" height={height}>
      {headerRows && sticky ? <Text color={theme.subtle} backgroundColor={theme.userBg} wrap="truncate-end">{fit(`❯ ${sticky.text}`, width - 1)} </Text> : null}
      {rows.slice(top, top + page).map((line, index) => <Text key={`${top}-${index}`} wrap="truncate-end">{line || ' '}</Text>)}
      {following ? null : (
        <Box width={width} justifyContent="center">
          <Text color={theme.userBg ? theme.text : theme.subtle} backgroundColor={theme.userBg}> {pill} </Text>
        </Box>
      )}
    </Box>
  );
};
