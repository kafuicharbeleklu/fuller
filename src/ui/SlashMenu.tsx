import React from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import type { SlashCommand } from './commands.js';
import { useTheme } from './theme.js';

/** Lines the suggestion list may use above the prompt, as in Claude Code 2.1.281. */
export const SUGGESTION_LINES = 5;

export interface Suggestion {
  label: string;
  description?: string;
}

/** Cut `text` to `width` columns, ending with "…" when it did not fit. */
function truncateEnd(text: string, width: number): string {
  if (stringWidth(text) <= width) return text;
  let out = '';
  for (const ch of text) {
    if (stringWidth(out + ch) > width - 1) break;
    out += ch;
  }
  return out + '…';
}

/** Keep the end of `text` within `width` columns, starting with "…" (long command names). */
function truncateStart(text: string, width: number): string {
  if (stringWidth(text) <= width) return text;
  const chars = [...text];
  let out = '';
  for (let i = chars.length - 1; i >= 0; i--) {
    if (stringWidth(chars[i] + out) > width - 1) break;
    out = chars[i] + out;
  }
  return '…' + out;
}

/** Word-wrap a description on at most two lines; the second one ends with "…" if text remains. */
export function wrapDescription(text: string, width: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (width < 2 || stringWidth(clean) <= width) return [clean];
  let first = '';
  let rest = clean;
  for (const word of clean.split(' ')) {
    const next = first ? `${first} ${word}` : word;
    if (stringWidth(next) > width) break;
    first = next;
    rest = rest.slice(word.length).trimStart();
  }
  if (!first) return [truncateEnd(clean, width)];
  return [first, truncateEnd(rest, width)];
}

/** `text` with the first case-insensitive occurrence of `query` in bold, like Claude Code's matches. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<Text bold>{text.slice(at, at + query.length)}</Text>{text.slice(at + query.length)}</>;
}

interface ListProps {
  items: Suggestion[];
  /** -1 when nothing is highlighted yet (the @ file list before navigation). */
  selectedIndex: number;
  width: number;
  query?: string;
}

/**
 * Suggestion list drawn above the prompt: two-space indent, labels in a column
 * of 40 % of the width when there are descriptions, the selected row in the
 * suggestion colour and the others grey, within five lines.
 */
export const SuggestionList: React.FC<ListProps> = ({ items, selectedIndex, width, query = '' }) => {
  const theme = useTheme();
  const columns = Math.max(20, width);
  const hasDescriptions = items.some((item) => item.description);
  // `width` is Ink's width, one column short of the terminal (LAYOUT_MARGIN in
  // index.tsx); Claude Code puts descriptions at 40 % of the terminal width.
  const labelWidth = hasDescriptions ? Math.floor((columns + 1) * 0.4) : columns - 3;
  const descriptionWidth = columns - 2 - labelWidth - 1;
  const rows = items.map((item) => ({
    item,
    description: hasDescriptions && item.description ? wrapDescription(item.description, descriptionWidth) : [],
  }));
  const height = (i: number) => Math.max(1, rows[i].description.length);

  // Scroll so the selection stays visible, then fill the five lines.
  const focus = Math.max(0, selectedIndex);
  let start = 0;
  const linesBetween = (from: number, to: number) => { let total = 0; for (let i = from; i <= to; i++) total += height(i); return total; };
  while (start < focus && linesBetween(start, focus) > SUGGESTION_LINES) start++;
  let end = start;
  let used = 0;
  while (end < rows.length && used + height(end) <= SUGGESTION_LINES) { used += height(end); end++; }

  return (
    <Box flexDirection="column" width={columns}>
      {rows.slice(start, Math.max(end, start + 1)).map(({ item, description }, offset) => {
        const selected = start + offset === selectedIndex;
        const color = selected ? theme.permission : theme.subtle;
        return (
          <Box key={item.label} flexDirection="row">
            <Box width={2} flexShrink={0} />
            <Box width={hasDescriptions ? labelWidth : undefined} flexShrink={0}>
              <Text color={color} wrap="truncate-end"><Highlighted text={truncateStart(item.label, labelWidth - 2)} query={query} /></Text>
            </Box>
            {description.length ? (
              <Box flexDirection="column" width={descriptionWidth} flexShrink={0}>
                {description.map((line, i) => <Text key={i} color={color}>{i === 0 ? <Highlighted text={line} query={query} /> : line}</Text>)}
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
};

interface SlashProps {
  commands: SlashCommand[];
  selectedIndex: number;
  width: number;
  query?: string;
}

/** Slash command menu (Claude Code layout). */
export const SlashMenu: React.FC<SlashProps> = ({ commands, selectedIndex, width, query }) => (
  <SuggestionList items={commands.map((command) => ({ label: command.name, description: command.description }))} selectedIndex={selectedIndex} width={width} query={query} />
);
