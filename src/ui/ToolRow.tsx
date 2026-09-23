import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { DiffView } from './DiffView.js';
import { toolLabel, toolArgSummary } from '../tools/registry.js';
import { BULLET, BULLET_GAP } from './glyphs.js';
import type { ToolCallState, TodoItem } from '../agent/types.js';
import { todoGlyph } from './TodoPanel.js';

interface ToolRowProps {
  toolCall: ToolCallState;
  verbose: boolean;
  /** Spinner frame when the tool is live (running/confirming). */
  frame?: string;
  elapsedMs?: number;
}

const COLLAPSED_LINES = 4;
const VERBOSE_LINES = 400;

function firstLines(text: string, max: number): { lines: string[]; hidden: number } {
  const all = text.replace(/\s+$/, '').split('\n');
  return { lines: all.slice(0, max), hidden: Math.max(0, all.length - max) };
}

export const ToolRow: React.FC<ToolRowProps> = ({ toolCall, verbose, frame, elapsedMs }) => {
  const theme = useTheme();
  const { status, name, args } = toolCall;
  const label = toolLabel(name);
  const arg = toolArgSummary(name, args);

  const iconColor =
    status === 'completed' ? theme.success
    : status === 'failed' ? theme.error
    : status === 'rejected' ? theme.warning
    : status === 'confirming' ? theme.permission
    : theme.accent;
  const icon = status === 'running' || status === 'confirming' ? (frame ?? BULLET) : status === 'pending' ? '·' : BULLET;
  const iconGap = icon === BULLET ? BULLET_GAP : ' ';

  const body = renderBody();

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={iconColor}>{icon}{iconGap}</Text>
        <Text bold color={theme.tool}>{label}</Text>
        <Text color={theme.subtle}>(</Text>
        <Text color={theme.text} wrap="truncate-end">{arg}</Text>
        <Text color={theme.subtle}>)</Text>
        {name === 'execute_bash' && args.description ? <Text color={theme.subtle}> — {String(args.description)}</Text> : null}
      </Box>
      {body}
    </Box>
  );

  function lines(items: React.ReactNode[]) {
    return (
      <Box flexDirection="column" marginLeft={2}>
        {items.map((node, i) => (
          <Box key={i}>
            <Text color={theme.subtle}>{i === 0 ? '⎿  ' : '   '}</Text>
            <Box flexGrow={1} flexDirection="column">{node}</Box>
          </Box>
        ))}
      </Box>
    );
  }

  function textLines(text: string, max: number, color?: string) {
    const { lines: ls, hidden } = firstLines(text, max);
    const nodes: React.ReactNode[] = ls.map((l, i) => <Text key={i} color={color ?? theme.subtle} wrap="truncate-end">{l || ' '}</Text>);
    if (hidden > 0) nodes.push(<Text key="more" color={theme.subtle}>… +{hidden} lines{verbose ? '' : ' (ctrl+o to expand)'}</Text>);
    return lines(nodes);
  }

  function renderBody(): React.ReactNode {
    if (status === 'pending') return null;
    if (status === 'confirming') return lines([<Text key="w" color={theme.permission}>Waiting for permission…</Text>]);
    if (status === 'running') {
      const tail = (toolCall.result ?? '').replace(/\s+$/, '').split('\n').filter(Boolean).slice(-4);
      const nodes: React.ReactNode[] = tail.map((l, i) => <Text key={i} color={theme.subtle} wrap="truncate-end">{l}</Text>);
      nodes.push(<Text key="r" color={theme.subtle}>Running…{elapsedMs && elapsedMs > 2000 ? ` ${Math.round(elapsedMs / 1000)}s` : ''}</Text>);
      return lines(nodes);
    }
    if (status === 'rejected') return lines([<Text key="x" color={theme.warning}>{toolCall.error || 'Rejected by user'}</Text>]);
    if (status === 'failed') return textLines(toolCall.error || 'Error', verbose ? VERBOSE_LINES : COLLAPSED_LINES, theme.error);

    const max = verbose ? VERBOSE_LINES : COLLAPSED_LINES;
    switch (name) {
      case 'todo_write': {
        const todos: TodoItem[] = Array.isArray(args.todos) ? args.todos : [];
        const shown = verbose ? todos : todos.slice(0, 8);
        const nodes: React.ReactNode[] = shown.map((t, i) => (
          <Text key={i} color={t.status === 'in_progress' ? theme.accent : t.status === 'completed' ? theme.subtle : theme.text} strikethrough={t.status === 'completed'} wrap="truncate-end">
            {todoGlyph(t.status)} {t.content}
          </Text>
        ));
        if (todos.length > shown.length) nodes.push(<Text key="more" color={theme.subtle}>… +{todos.length - shown.length} more (ctrl+o to expand)</Text>);
        return lines(nodes.length ? nodes : [<Text key="e" color={theme.subtle}>(empty list)</Text>]);
      }
      case 'edit_file':
      case 'write_file': {
        const nodes: React.ReactNode[] = [];
        if (toolCall.summary) nodes.push(<Text key="s" color={theme.subtle}>{toolCall.summary}</Text>);
        if (toolCall.diff) nodes.push(<DiffView key="d" diff={toolCall.diff} maxLines={verbose ? 2000 : 30} />);
        return lines(nodes.length ? nodes : [<Text key="s" color={theme.subtle}>{toolCall.result}</Text>]);
      }
      case 'read_file': {
        if (!verbose) return lines([<Text key="s" color={theme.subtle}>{toolCall.summary || 'Read file'}</Text>]);
        return textLines(`${toolCall.summary}\n${toolCall.result ?? ''}`, 60);
      }
      case 'search_files':
      case 'glob':
      case 'list_directory': {
        const result = toolCall.result ?? '';
        if (!verbose) {
          const { lines: ls, hidden } = firstLines(result, COLLAPSED_LINES);
          const nodes: React.ReactNode[] = [<Text key="s" color={theme.subtle}>{toolCall.summary}</Text>];
          ls.slice(0, 3).forEach((l, i) => nodes.push(<Text key={i} color={theme.subtle} wrap="truncate-end">{l}</Text>));
          if (hidden > 0 || ls.length > 3) nodes.push(<Text key="m" color={theme.subtle}>… (ctrl+o to expand)</Text>);
          return lines(nodes);
        }
        return textLines(result, VERBOSE_LINES);
      }
      case 'web_fetch':
        return textLines(`${toolCall.summary ?? ''}\n${toolCall.result ?? ''}`, verbose ? 200 : 3);
      default:
        return textLines(toolCall.result || toolCall.summary || 'Done', max);
    }
  }
};
