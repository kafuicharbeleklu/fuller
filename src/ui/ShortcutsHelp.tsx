import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from './theme.js';

/**
 * Shortcut help opened with `?` on an empty prompt, laid out like Claude Code
 * 2.1.281: three grey columns in place of the footer. Column bases match its
 * positions at 100 columns (2, 26, 61); narrower terminals shrink them
 * proportionally and wrap, as Yoga does in Claude Code.
 * Only shortcuts that Fuller implements are listed.
 */
const COLUMNS: Array<{ basis: number; lines: string[] }> = [
  { basis: 24, lines: ['! for shell mode', '/ for commands', '@ for file paths', '/btw for side question'] },
  { basis: 35, lines: ['double tap esc to clear input', 'shift + tab to auto-accept edits', 'ctrl + o for verbose output', 'ctrl + t to toggle tasks', '\\⏎ for newline'] },
  { basis: 27, lines: ['ctrl + shift + _ to undo', 'ctrl + z to suspend', 'ctrl + v to paste images', 'alt + p to switch model', 'ctrl + s to stash prompt', 'ctrl + g to edit in $EDITOR', '/keybindings to customize'] },
];

/** Rows the help takes beyond the one-line footer it replaces. */
export const SHORTCUTS_HELP_EXTRA_ROWS = Math.max(...COLUMNS.map((column) => column.lines.length)) - 1;

/**
 * Column widths: the bases when they fit, otherwise the bases scaled down
 * proportionally (as Yoga shrinks them in Claude Code), the last column taking
 * what is left. Explicit widths let Ink wrap each line at word boundaries.
 */
export function shortcutColumnWidths(columns: number): number[] {
  // The app draws one column short of the terminal width; 2 more go to the left padding.
  const available = Math.max(COLUMNS.length, columns - 3);
  const total = COLUMNS.reduce((sum, column) => sum + column.basis, 0);
  if (total <= available) return COLUMNS.map((column, i) => (i === COLUMNS.length - 1 ? available - total + column.basis : column.basis));
  const widths = COLUMNS.slice(0, -1).map((column) => Math.max(1, Math.round(column.basis * available / total)));
  return [...widths, Math.max(1, available - widths.reduce((sum, width) => sum + width, 0))];
}

export const ShortcutsHelp: React.FC<{ color?: string }> = ({ color }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const widths = shortcutColumnWidths(stdout.columns || 80);
  return (
    <Box flexDirection="row" paddingLeft={2}>
      {COLUMNS.map((column, i) => (
        <Box key={i} flexDirection="column" width={widths[i]} flexShrink={0}>
          {column.lines.map((line) => <Text key={line} color={color ?? theme.subtle} wrap="wrap">{line}</Text>)}
        </Box>
      ))}
    </Box>
  );
};
