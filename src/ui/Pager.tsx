import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import stripAnsi from 'strip-ansi';
import { useRawInput } from './useRawInput.js';
import { useTheme } from './theme.js';

interface Props {
  title: string;
  /** Left side of the bottom status line (Claude Code: "Showing detailed transcript · ctrl+o to toggle · ? for shortcuts"). */
  status?: string;
  /** Right side of the status line, e.g. "verbose". */
  rightLabel?: string;
  /** Lines carry ANSI styles and are already laid out: wrap them, no horizontal scroll. */
  ansi?: boolean;
  lines: string[];
  onClose: () => void;
  onRefresh?: () => void;
  onToggleDetails?: () => void;
  sectionPrefix?: string;
  onExport?: () => (() => void);
  onOpenEditor?: () => void;
}

export function visibleColumns(line: string, left: number, width: number): string {
  let column = 0;
  let result = '';
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line)) {
    const size = stringWidth(segment);
    if (column + size <= left) { column += size; continue; }
    if (column < left) { column += size; continue; }
    if (column + size > left + width) break;
    result += segment;
    column += size;
  }
  return result;
}

/** A bounded, searchable view of long transcripts and diffs. */
export const Pager: React.FC<Props> = ({ title, status, rightLabel, ansi = false, lines: rawLines, onClose, onRefresh, onToggleDetails, onExport, onOpenEditor, sectionPrefix = '❯ ' }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const [showKeys, setShowKeys] = useState(false);
  const lines = useMemo(() => (ansi ? rawLines.flatMap((line) => wrapAnsi(line, Math.max(1, (stdout.columns || 80) - 2), { hard: true, trim: false }).split('\n')) : rawLines), [ansi, rawLines, stdout.columns]);
  const plain = useMemo(() => (ansi ? lines.map((line) => stripAnsi(line)) : lines), [ansi, lines]);
  const keyLines = 2;
  // Content, then a dim rule and one status line, as in Claude Code's transcript mode.
  const page = Math.max(3, (stdout.rows || 24) - 3 - (showKeys ? keyLines : 0));
  const [top, setTop] = useState(Math.max(0, lines.length - page));
  const [left, setLeft] = useState(0);
  const [query, setQuery] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [exported, setExported] = useState(false);
  useEffect(() => {
    if (exported) return onExport?.();
  }, [exported]);
  const maxTop = Math.max(0, lines.length - page);
  useEffect(() => { setTop((value) => Math.min(value, maxTop)); }, [maxTop]);
  // Rendered lines can arrive after the first frame: open on the latest part once they do.
  const hadLines = React.useRef(lines.length > 0);
  useEffect(() => { if (!hadLines.current && lines.length > 0) { hadLines.current = true; setTop(maxTop); } }, [lines.length, maxTop]);

  const jumpMatch = (direction: -1 | 1, needle = lastQuery) => {
    if (!needle) return;
    const lower = needle.toLocaleLowerCase();
    const found = plain.flatMap((line, index) => line.toLocaleLowerCase().includes(lower) ? [index] : []);
    const next = direction > 0 ? found.find((index) => index > top) ?? found[0] : [...found].reverse().find((index) => index < top) ?? found[found.length - 1];
    if (next === undefined) { setNotice('No matches'); return; }
    setTop(Math.min(next, maxTop));
    const column = plain[next].toLocaleLowerCase().indexOf(lower);
    if (column >= 0 && !ansi) setLeft(Math.max(0, stringWidth(plain[next].slice(0, column)) - 4));
    setNotice(`${found.length} match${found.length === 1 ? '' : 'es'}`);
  };

  const jumpSection = (direction: -1 | 1) => {
    const found = plain.flatMap((line, index) => line.startsWith(sectionPrefix) ? [index] : []);
    const next = direction > 0 ? found.find((index) => index > top) ?? found[0] : [...found].reverse().find((index) => index < top) ?? found[found.length - 1];
    if (next !== undefined) { setTop(Math.min(next, maxTop)); setLeft(0); }
  };

  useRawInput((event) => {
    if (exported) {
      if (event.name === 'escape' || (event.name === 'char' && (event.text === 'q' || (event.ctrl && ['c', 'o'].includes(event.text))))) onClose();
      return;
    }
    if (event.name === 'mouse') {
      if (event.mouse?.button === 64) setTop((value) => Math.max(0, value - 3));
      if (event.mouse?.button === 65) setTop((value) => Math.min(maxTop, value + 3));
      return;
    }
    if (query !== null) {
      if (event.name === 'escape') { setQuery(null); return; }
      if (event.name === 'return') { setLastQuery(query); setQuery(null); jumpMatch(1, query); return; }
      if (event.name === 'backspace') { setQuery(query.slice(0, -1)); return; }
      if (event.name === 'char' && !event.ctrl && !event.alt) setQuery(query + event.text);
      return;
    }
    if (event.name === 'escape' || (event.name === 'char' && event.ctrl && (event.text.toLowerCase() === 'o' || event.text.toLowerCase() === 'c')) || (event.name === 'char' && event.text === 'q')) { onClose(); return; }
    // Claude Code's Transcript bindings (2.1.283 binary): ctrl+p/ctrl+n a line, ctrl+b/ctrl+f a page, ctrl+u/ctrl+d half.
    if (event.name === 'up' || (event.name === 'char' && (event.text === 'k' || (event.ctrl && event.text === 'p')))) setTop((value) => Math.max(0, value - 1));
    else if (event.name === 'down' || (event.name === 'char' && (event.text === 'j' || (event.ctrl && event.text === 'n')))) setTop((value) => Math.min(maxTop, value + 1));
    else if (event.name === 'char' && event.ctrl && event.text === 'u') setTop((value) => Math.max(0, value - Math.max(1, Math.floor(page / 2))));
    else if (event.name === 'char' && event.ctrl && event.text === 'd') setTop((value) => Math.min(maxTop, value + Math.max(1, Math.floor(page / 2))));
    else if (event.name === 'pageup' || (event.name === 'char' && (event.text === 'b' || (event.ctrl && event.text === 'b')))) setTop((value) => Math.max(0, value - page));
    else if (event.name === 'pagedown' || (event.name === 'char' && (event.text === ' ' || (event.ctrl && event.text === 'f')))) setTop((value) => Math.min(maxTop, value + page));
    else if (event.name === 'home' || (event.name === 'char' && event.text === 'g')) setTop(0);
    else if (event.name === 'end' || (event.name === 'char' && event.text === 'G')) setTop(maxTop);
    else if (!ansi && (event.name === 'left' || (event.name === 'char' && event.text === 'h'))) setLeft((value) => Math.max(0, value - 16));
    else if (!ansi && (event.name === 'right' || (event.name === 'char' && event.text === 'l'))) setLeft((value) => value + 16);
    else if (event.name === 'char' && event.text === '?') setShowKeys((value) => !value);
    else if (event.name === 'char' && event.text === '/') { setQuery(''); setNotice(''); }
    else if (event.name === 'char' && event.text === 'n') jumpMatch(1);
    else if (event.name === 'char' && event.text === 'N') jumpMatch(-1);
    else if (event.name === 'char' && event.text === '{') jumpSection(-1);
    else if (event.name === 'char' && event.text === '}') jumpSection(1);
    else if (event.name === 'char' && event.text === '[' && onExport) setExported(true);
    else if (event.name === 'char' && event.text === 'v') onOpenEditor?.();
    else if (event.name === 'char' && event.text === 'r') onRefresh?.();
    else if (event.name === 'char' && event.ctrl && event.text.toLowerCase() === 'e') onToggleDetails?.();
  });

  if (exported) return null;
  const columns = Math.max(1, (stdout.columns || 80));
  const statusText = query !== null ? `/${query}_` : `${status ?? `${title} · q to close · ? for shortcuts`}${notice ? ` · ${notice}` : ''}`;
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" height={page} paddingX={ansi ? 0 : 1}>
        {lines.slice(top, top + page).map((line, index) => (
          <Text key={`${top}-${index}`} wrap="truncate-end" color={ansi ? undefined : lastQuery && line.toLocaleLowerCase().includes(lastQuery.toLocaleLowerCase()) ? theme.accent : theme.text} inverse={ansi && !!lastQuery && plain[top + index].toLocaleLowerCase().includes(lastQuery.toLocaleLowerCase())}>{ansi ? line || ' ' : visibleColumns(line, left, Math.max(1, columns - 3)) || ' '}</Text>
        ))}
      </Box>
      {showKeys ? (
        <Box flexDirection="column" paddingX={2}>
          <Text color={theme.subtle} wrap="truncate-end">q/esc close · {top + 1}-{Math.min(lines.length, top + page)}/{lines.length} · ↑↓ j/k line · space/b page · ctrl+u/d half page · g/G top/bottom · ←→ columns</Text>
          <Text color={theme.subtle} wrap="truncate-end">/ search · n/N match · {'{'}{'}'} prompt{onExport ? ' · [ scrollback · v editor' : ''}{onRefresh ? ' · r refresh' : ''}{onToggleDetails ? ' · ctrl+e details' : ''}</Text>
        </Box>
      ) : null}
      <Text dimColor>{'─'.repeat(columns)}</Text>
      <Box justifyContent="space-between" paddingLeft={2} paddingRight={1}>
        <Text color={query !== null ? theme.accent : theme.subtle} wrap="truncate-end">{statusText}</Text>
        {rightLabel ? <Text color={theme.subtle}>{rightLabel}</Text> : null}
      </Box>
    </Box>
  );
};
