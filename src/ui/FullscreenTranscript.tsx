import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import wrapAnsi from 'wrap-ansi';
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
  const [rows, setRows] = useState<TranscriptRows>({ lines: [], owners: [] });
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
      for (const item of verbose ? items : groupToolItems(items)) {
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
        out.push(...lines);
        const owner = !verbose && CLICKABLE.has(item.kind) ? item.key : null;
        for (let i = 0; i < lines.length; i++) owners.push(owner);
      }
      cache.current = next;
      if (live) {
        const text = renderToString(<ThemeProvider theme={theme}><LiveArea live={live} verbose={verbose} frame={frame} maxLines={100_000} permissionOpen={permissionOpen} /></ThemeProvider>, width, 1000);
        if (text) for (const line of text.split('\n')) { out.push(line); owners.push(null); }
      }
      setRows({ lines: out, owners });
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
}

/** Bounded alternate-screen transcript; native scrollback remains available in classic mode. */
export const FullscreenTranscript: React.FC<Props> = ({ lines, height, scrollRequest, width: fixedWidth, owners, clickRequest, onToggleItem }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = Math.max(20, fixedWidth ?? (stdout.columns || 80));
  const { rows, rowOwners } = useMemo(() => {
    const outRows: string[] = [];
    const outOwners: Array<string | null> = [];
    lines.forEach((line, i) => { for (const part of wrapLine(line, width)) { outRows.push(part); outOwners.push(owners?.[i] ?? null); } });
    return { rows: outRows, rowOwners: outOwners };
  }, [lines, owners, width]);
  const [following, setFollowing] = useState(true);
  // While scrolled up, the last row shows how to get back, like Claude Code's "Jump to bottom".
  const page = Math.max(1, following ? height : height - 1);
  const maxTop = Math.max(0, rows.length - page);
  const [top, setTop] = useState(maxTop);
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
    if (!clickRequest?.id || clickRequest.row < 0 || clickRequest.row >= page) return;
    const owner = rowOwners[top + clickRequest.row];
    if (owner) onToggleItem?.(owner);
  }, [clickRequest?.id]);
  return (
    <Box flexDirection="column" height={height}>
      {rows.slice(top, top + page).map((line, index) => <Text key={`${top}-${index}`} wrap="truncate-end">{line || ' '}</Text>)}
      {following ? null : <Text color={theme.subtle}>  ↓ Jump to bottom (ctrl+end)</Text>}
    </Box>
  );
};
