import React, { useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from './theme.js';
import { Select } from './Select.js';
import { useRawInput } from './useRawInput.js';
import type { McpApproval } from '../mcp/approval.js';

const RISK = 'MCP servers may execute code or access system resources. All tool calls require approval. Learn more in the MCP documentation.';

/**
 * Claude Code 2.1.282's question about a project's new MCP servers, before any of them starts.
 * One server: three choices, "Continue without" selected. Several: a checklist, every server
 * checked, Space to toggle, "Enable selected" to confirm, Esc to reject all.
 */
export const McpApprovalDialog: React.FC<{ names: string[]; onDone: (answer: McpApproval) => void }> = ({ names, onDone }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = Math.max(20, (stdout.columns || 80) - 1);
  const frame = (title: string, body: React.ReactNode, hint: string, subtitle?: string) => (
    <Box flexDirection="column" width={width}>
      <Text color={theme.warning}>{'─'.repeat(width)}</Text>
      <Box flexDirection="column" paddingX={2}>
        <Text bold color={theme.warning}>{title}</Text>
        {subtitle ? <Text color={theme.subtle}>{subtitle}</Text> : null}
        <Text wrap="wrap">{RISK}</Text>
        <Text> </Text>
        {body}
      </Box>
      <Text color={theme.subtle}> {hint}</Text>
    </Box>
  );

  if (names.length === 1) {
    const [name] = names;
    return frame(
      `New MCP server found in this project: ${name}`,
      <Select
        items={[
          { label: 'Use this MCP server', value: 'use' },
          { label: 'Use this and all future MCP servers in this project', value: 'all' },
          { label: 'Continue without using this MCP server', value: 'skip' },
        ]}
        numbered={false}
        initialIndex={2}
        onSelect={(choice) => onDone(choice === 'skip' ? { enabled: [], disabled: [name] } : { enabled: [name], disabled: [], all: choice === 'all' })}
        onCancel={() => onDone({ enabled: [], disabled: [name] })}
      />,
      'Enter to confirm · Esc to cancel',
    );
  }
  return <Checklist names={names} onDone={onDone} frame={frame} />;
};

const Checklist: React.FC<{
  names: string[];
  onDone: (answer: McpApproval) => void;
  frame: (title: string, body: React.ReactNode, hint: string, subtitle?: string) => React.ReactElement;
}> = ({ names, onDone, frame }) => {
  const theme = useTheme();
  const [checked, setChecked] = useState<boolean[]>(() => names.map(() => true));
  // 0..n-1: the servers; n: "Enable selected".
  const [index, setIndex] = useState(0);
  const confirm = () => onDone({ enabled: names.filter((_, i) => checked[i]), disabled: names.filter((_, i) => !checked[i]) });
  const toggle = (i: number) => setChecked((c) => c.map((v, j) => (j === i ? !v : v)));
  useRawInput((e) => {
    if (e.name === 'escape' || (e.name === 'char' && e.ctrl && e.text === 'c')) onDone({ enabled: [], disabled: [...names] });
    else if (e.name === 'up') setIndex((i) => (i <= 0 ? names.length : i - 1));
    else if (e.name === 'down') setIndex((i) => (i >= names.length ? 0 : i + 1));
    else if (e.name === 'char' && e.text === ' ' && index < names.length) toggle(index);
    else if (e.name === 'return') { if (index < names.length) toggle(index); else confirm(); }
  });
  return frame(
    `${names.length} new MCP servers found in this project`,
    <Box flexDirection="column">
      {names.map((name, i) => (
        <Text key={name}>
          <Text color={theme.permission}>{i === index ? '❯ ' : '  '}</Text>
          <Text color={checked[i] ? theme.success : theme.subtle}>{checked[i] ? '[✔]' : '[ ]'} </Text>
          <Text color={i === index ? theme.permission : undefined}>{name}</Text>
        </Text>
      ))}
      <Text>
        <Text color={theme.permission}>{index === names.length ? '❯ ' : '  '}</Text>
        <Text bold color={index === names.length ? theme.permission : undefined}>{'     Enable selected'}</Text>
      </Text>
    </Box>,
    'Space to select · Esc to reject all',
    'Select any you wish to enable.',
  );
};
