import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from './theme.js';
import { DiffView, diffStats } from './DiffView.js';
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
  permissionOpen?: boolean;
}

const COLLAPSED_LINES = 4;
const VERBOSE_LINES = 400;

function firstLines(text: string, max: number): { lines: string[]; hidden: number } {
  const all = text.replace(/\s+$/, '').split('\n');
  return { lines: all.slice(0, max), hidden: Math.max(0, all.length - max) };
}

export const ToolRow: React.FC<ToolRowProps> = ({ toolCall, verbose, frame, elapsedMs, permissionOpen = false }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const { status, name, args } = toolCall;
  // Claude Code names a file edit "Update".
  const label = name === 'edit_file' ? 'Update' : toolLabel(name);
  const fileArg = name === 'read_file' || name === 'edit_file' || name === 'write_file';
  const arg = toolArgSummary(name, args);

  const iconColor =
    status === 'completed' ? theme.success
    : status === 'failed' ? theme.error
    : status === 'rejected' ? theme.warning
    : status === 'confirming' ? theme.subtle
    : theme.accent;
  const icon = status === 'confirming' && permissionOpen ? BULLET : status === 'running' || status === 'confirming' ? (frame ?? BULLET) : status === 'pending' ? '·' : BULLET;
  const iconGap = icon === BULLET ? BULLET_GAP : ' ';

  const body = renderBody();

  // A command typed with "!": Claude Code shows only its output under the user's line.
  if (toolCall.origin === 'user') return <Box flexDirection="column">{body}</Box>;

  return (
    <Box flexDirection="column">
      <Box>
        <Text wrap="truncate-end">
          <Text color={iconColor}>{icon}{iconGap}</Text>
          <Text bold color={theme.tool}>{label}</Text>
          <Text color={theme.subtle}>(</Text>
          <Text color={theme.text} underline={fileArg}>{arg}</Text>
          <Text color={theme.subtle}>)</Text>
        </Text>
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
    if (status === 'confirming') return lines([<Text key="w" color={theme.subtle}>{permissionOpen ? 'Running…' : 'Waiting for permission…'}</Text>]);
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
        if (toolCall.diff) {
          // Claude Code: "Added 1 line, removed 1 line" with the counts in bold, then the diff.
          const { additions, removals } = diffStats(toolCall.diff);
          const parts: React.ReactNode[] = [];
          if (additions) parts.push(<React.Fragment key="a">Added <Text bold>{additions}</Text> {additions === 1 ? 'line' : 'lines'}</React.Fragment>);
          if (removals) parts.push(<React.Fragment key="r">{parts.length ? ', removed' : 'Removed'} <Text bold>{removals}</Text> {removals === 1 ? 'line' : 'lines'}</React.Fragment>);
          nodes.push(<Text key="s" color={theme.text}>{parts.length ? parts : toolCall.summary}</Text>);
          nodes.push(<DiffView key="d" diff={toolCall.diff} maxLines={verbose ? 2000 : 30} width={Math.max(20, columns - 12)} />);
        } else if (toolCall.summary) nodes.push(<Text key="s" color={theme.subtle}>{toolCall.summary}</Text>);
        return lines(nodes.length ? nodes : [<Text key="s" color={theme.subtle}>{toolCall.result}</Text>]);
      }
      case 'read_file': {
        // Claude Code: "Read 2 lines" with the count in bold, without the file content.
        const summary = toolCall.summary || 'Read file';
        const match = summary.match(/^(\D*)(\d+)(.*)$/);
        return lines([<Text key="s" color={theme.text}>{match ? <>{match[1]}<Text bold>{match[2]}</Text>{match[3]}</> : summary}</Text>]);
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
      case 'execute_bash':
        // Shell output in the text colour, as Claude Code prints it.
        return textLines(toolCall.result || toolCall.summary || 'Done', max, theme.text);
      default:
        return textLines(toolCall.result || toolCall.summary || 'Done', max);
    }
  }
};
