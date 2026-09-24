import React from 'react';
import { Box, Text } from 'ink';
import { useTheme, type Theme } from './theme.js';
/** Claude Code's token counts: 950, 26.1k, 1m. */
export function shortTokens(n: number): string {
  const trim = (value: number) => value.toFixed(1).replace(/\.0$/, '');
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}m`;
  if (n >= 1000) return `${trim(n / 1000)}k`;
  return String(Math.round(n));
}

export interface ContextCategory {
  name: string;
  tokens: number;
  /** Theme key of the category colour. */
  color: keyof Theme;
}

export interface ContextData {
  modelLabel: string;
  modelId: string;
  window: number;
  /** Share of the window kept free before auto-compaction (e.g. 0.15). */
  bufferShare: number;
  categories: ContextCategory[];
  skills: { count: number; tokens: number };
}

const CELLS = 200;
const PER_ROW = 20;

type Cell = { glyph: string; color: keyof Theme };

/**
 * Claude Code 2.1.281 grid: each category takes full cells (⛁) and a partial
 * one (⛀) when its remainder is at least half a cell or it has no full cell;
 * the auto-compact buffer (⛝) fills the last cells, free space (⛶) the rest.
 */
export function contextCells(data: ContextData): Cell[] {
  const size = data.window / CELLS;
  const cells: Cell[] = [];
  for (const category of data.categories) {
    if (category.tokens <= 0) continue;
    const exact = category.tokens / size;
    const full = Math.floor(exact);
    for (let i = 0; i < full; i++) cells.push({ glyph: '⛁', color: category.color });
    if (full === 0 || exact - full >= 0.5) cells.push({ glyph: '⛀', color: category.color });
  }
  const buffer = Math.round(CELLS * data.bufferShare);
  while (cells.length < CELLS - buffer) cells.push({ glyph: '⛶', color: 'subtle' });
  while (cells.length < CELLS) cells.push({ glyph: '⛝', color: 'subtle' });
  return cells.slice(0, CELLS);
}

const percent = (tokens: number, window: number) => `${((tokens / window) * 100).toFixed(1)}%`;

export const ContextView: React.FC<{ data: ContextData }> = ({ data }) => {
  const theme = useTheme();
  const cells = contextCells(data);
  const used = data.categories.reduce((sum, category) => sum + category.tokens, 0);
  const buffer = Math.round(data.window * data.bufferShare);
  const free = Math.max(0, data.window - used - buffer);
  const side: React.ReactNode[] = [
    <Text key="m">{data.modelLabel}</Text>,
    <Text key="i">{data.modelId}</Text>,
    <Text key="t">{shortTokens(used)}/{shortTokens(data.window)} tokens ({Math.round((used / data.window) * 100)}%)</Text>,
    <Text key="b"> </Text>,
    <Text key="h">Estimated usage by category</Text>,
    ...data.categories.map((category) => (
      <Text key={category.name}><Text color={theme[category.color] as string}>⛁ </Text>{category.name}: <Text color={theme.subtle}>{shortTokens(category.tokens)} tokens ({percent(category.tokens, data.window)})</Text></Text>
    )),
    <Text key="f"><Text color={theme.subtle}>⛶ </Text>Free space: <Text color={theme.subtle}>{shortTokens(free)} ({percent(free, data.window)})</Text></Text>,
    <Text key="a" color={theme.subtle}>⛝ Autocompact buffer: {shortTokens(buffer)} tokens ({percent(buffer, data.window)})</Text>,
  ];
  const rows = CELLS / PER_ROW;
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text><Text color={theme.subtle}>⎿  </Text><Text bold>Context Usage</Text></Text>
      <Box flexDirection="column" marginLeft={3}>
        {Array.from({ length: Math.max(rows, side.length) }, (_, row) => (
          <Box key={row} flexDirection="row">
            <Box width={PER_ROW * 2} flexShrink={0}>
              {row < rows ? (
                <Text>{cells.slice(row * PER_ROW, row * PER_ROW + PER_ROW).map((cell, i) => <Text key={i} color={theme[cell.color] as string}>{cell.glyph} </Text>)}</Text>
              ) : <Text> </Text>}
            </Box>
            <Box marginLeft={2}>{side[row] ?? <Text> </Text>}</Box>
          </Box>
        ))}
        <Text><Text bold>Auto-compact window:</Text> <Text color={theme.subtle}>{shortTokens(data.window)} tokens</Text></Text>
        <Text><Text bold>Skills</Text> <Text color={theme.subtle}>· /skills</Text></Text>
        <Text color={theme.subtle}>└ {data.skills.count} skills · {shortTokens(data.skills.tokens)} tokens</Text>
      </Box>
    </Box>
  );
};
