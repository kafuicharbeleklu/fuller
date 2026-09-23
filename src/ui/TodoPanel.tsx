import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import type { TodoItem } from '../agent/types.js';

interface Props {
  todos: TodoItem[];
  frame: string;
  maxItems?: number;
}

export function todoGlyph(status: TodoItem['status'], frame?: string): string {
  if (status === 'completed') return '☑';
  if (status === 'in_progress') return frame ?? '◐';
  return '☐';
}

/** Sticky task list shown above the input while work is in progress (ctrl+t toggles it). */
export const TodoPanel: React.FC<Props> = ({ todos, frame, maxItems = 6 }) => {
  const theme = useTheme();
  if (todos.length === 0) return null;
  const done = todos.filter((t) => t.status === 'completed').length;
  const activeIndex = todos.findIndex((t) => t.status === 'in_progress');
  // Keep the in-progress item visible: window around it.
  let start = 0;
  if (todos.length > maxItems && activeIndex >= 0) start = Math.max(0, Math.min(activeIndex - 1, todos.length - maxItems));
  const visible = todos.slice(start, start + maxItems);
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text color={theme.subtle}>
        Tasks <Text color={theme.text}>{done}/{todos.length}</Text> <Text color={theme.subtle}>(ctrl+t to hide)</Text>
      </Text>
      {start > 0 ? <Text color={theme.subtle}>  … {start} done</Text> : null}
      {visible.map((t, i) => {
        const inProgress = t.status === 'in_progress';
        const completed = t.status === 'completed';
        return (
          <Text key={start + i} color={inProgress ? theme.accent : completed ? theme.subtle : theme.text} strikethrough={completed} wrap="truncate-end">
            {'  '}{todoGlyph(t.status, inProgress ? frame : undefined)} {inProgress && t.activeForm ? t.activeForm : t.content}
          </Text>
        );
      })}
      {start + maxItems < todos.length ? <Text color={theme.subtle}>  … +{todos.length - start - maxItems} more</Text> : null}
    </Box>
  );
};
