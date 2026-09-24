import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { groupToolItems, toolGroupParts, ToolGroupRow } from '../src/ui/ToolGroup.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import type { ToolCallState, TranscriptItem } from '../src/agent/types.js';

const tool = (id: string, name: string, args: Record<string, unknown> = {}, status: ToolCallState['status'] = 'completed'): TranscriptItem =>
  ({ key: id, kind: 'tool', messageId: 'm', toolCall: { id, name, args, status } });

describe('tool call groups (Claude Code 2.1.281)', () => {
  it('folds consecutive finished read-only calls and keeps edits and failures apart', () => {
    const items: TranscriptItem[] = [
      tool('a', 'read_file', { file_path: 'README.md' }),
      tool('b', 'execute_bash', { command: 'ls -la' }),
      tool('c', 'edit_file', { file_path: 'x' }),
      tool('d', 'read_file', {}, 'failed'),
    ];
    const grouped = groupToolItems(items);
    expect(grouped.map((item) => item.kind)).toEqual(['tool_group', 'tool', 'tool']);
  });

  it('writes the summary like Claude Code, counting ls as a listing and a shell command', () => {
    const grouped = groupToolItems([tool('a', 'read_file'), tool('b', 'execute_bash', { command: 'ls -la' })]);
    const tools = grouped[0].kind === 'tool_group' ? grouped[0].tools : [];
    expect(toolGroupParts(tools).map((part) => part.join(' '))).toEqual(['Read 1 file', 'listed 1 directory', 'ran 1 shell command']);
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><ToolGroupRow tools={tools} /></ThemeProvider>);
    expect(screen.lastFrame()?.trim()).toBe('Read 1 file, listed 1 directory, ran 1 shell command');
    screen.unmount();
  });

  it('never folds a command the user ran with "!"', () => {
    const run = tool('b', 'execute_bash', { command: 'ls' });
    if (run.kind === 'tool') run.toolCall.origin = 'user';
    expect(groupToolItems([run]).map((item) => item.kind)).toEqual(['tool']);
  });
});
