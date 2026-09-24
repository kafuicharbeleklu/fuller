import React, { useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from './theme.js';
import { Select } from './Select.js';
import { OverlayFrame } from './OverlayFrame.js';
import { useRawInput } from './useRawInput.js';
import { shortAge } from './AgentsView.js';
import type { ConversationCheckpoint } from '../session/store.js';

type RewindScope = 'code' | 'conversation' | 'both' | 'summarizeFrom' | 'summarizeUpTo';

interface Props {
  /** Newest first, as the agent keeps them. */
  checkpoints: ConversationCheckpoint[];
  /** Files the agent edited in each turn, for "No code changes". */
  codeChanges?: (id: string) => string[];
  onAction: (id: string, scope: RewindScope) => void;
  onCancel: () => void;
}

const firstLine = (prompt: string) => prompt.split('\n')[0];
const changesLabel = (files: string[]) => (files.length ? `${files.length} file${files.length === 1 ? '' : 's'} changed` : 'No code changes');

/**
 * /rewind as Claude Code 2.1.281 draws it: the prompts from oldest to newest,
 * each with its code changes, and "(current)" selected at the bottom. Choosing
 * a prompt asks for confirmation, quoting it, with what will happen and the
 * ways to restore. The conversation before the rewind is kept as a session.
 */
export const RewindMenu: React.FC<Props> = ({ checkpoints, codeChanges = () => [], onAction, onCancel }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const rows = stdout.rows || 24;
  const prompts = [...checkpoints].reverse();
  // The last row is "(current)": nothing to restore.
  const [index, setIndex] = useState(prompts.length);
  const [chosen, setChosen] = useState<ConversationCheckpoint | null>(null);
  const page = Math.max(1, Math.floor((rows - 26) / 2));
  const total = prompts.length + 1;

  useRawInput((e) => {
    if (e.name === 'escape' || (e.name === 'char' && e.ctrl && e.text === 'c')) onCancel();
    else if (e.name === 'up') setIndex((i) => Math.max(0, i - 1));
    else if (e.name === 'down') setIndex((i) => Math.min(total - 1, i + 1));
    else if (e.name === 'return') { if (index >= prompts.length) onCancel(); else setChosen(prompts[index]); }
  }, { isActive: !chosen });

  if (!prompts.length) {
    return (
      <OverlayFrame title="Rewind" hint="Esc to cancel">
        <Text>Nothing to rewind to yet.</Text>
      </OverlayFrame>
    );
  }

  if (chosen) {
    const files = codeChanges(chosen.id);
    const options: Array<{ label: string; value: RewindScope | 'cancel' }> = [
      ...(files.length ? [{ label: 'Restore code and conversation', value: 'both' as const }] : []),
      { label: 'Restore conversation', value: 'conversation' },
      ...(files.length ? [{ label: 'Restore code', value: 'code' as const }] : []),
      { label: 'Summarize from here', value: 'summarizeFrom' },
      { label: 'Summarize up to here', value: 'summarizeUpTo' },
      { label: 'Never mind', value: 'cancel' },
    ];
    return (
      <OverlayFrame title="Rewind">
        <Text>Confirm you want to restore to the point before you sent this message:</Text>
        <Text wrap="truncate-end"><Text dimColor>│ </Text><Text color={theme.user}>{firstLine(chosen.prompt)}</Text></Text>
        <Text><Text dimColor>│ </Text><Text color={theme.subtle}>({shortAge(Date.now() - chosen.timestamp)} ago)</Text></Text>
        <Text color={theme.subtle}>The conversation will be forked.</Text>
        <Text color={theme.subtle}>{files.length ? `The code in ${files.length} file${files.length === 1 ? '' : 's'} can be restored.` : 'The code will be unchanged.'}</Text>
        <Select
          items={options}
          numbered
          onSelect={(value) => { if (value === 'cancel') setChosen(null); else onAction(chosen.id, value as RewindScope); }}
          onCancel={() => setChosen(null)}
        />
      </OverlayFrame>
    );
  }

  // Anchored like Claude Code: the selection is the last visible row unless near the top.
  const offset = Math.max(0, Math.min(index - page + 1, total - page));
  const visible = Array.from({ length: Math.min(page, total - offset) }, (_, i) => offset + i);
  const below = total - offset - visible.length;
  return (
    <OverlayFrame title="Rewind" hint="Enter to continue · Esc to cancel">
      <Text>Restore the code and/or conversation to the point before…</Text>
      {offset > 0 ? <Text color={theme.subtle}>  ↑ {offset} more above</Text> : null}
      {visible.map((i) => {
        const selected = i === index;
        const checkpoint = prompts[i];
        const label = checkpoint ? firstLine(checkpoint.prompt) : '(current)';
        return (
          <Box key={checkpoint?.id ?? 'current'} flexDirection="column">
            <Text wrap="truncate-end">{selected ? <Text bold color={theme.permission}>❯ </Text> : '  '}<Text color={selected ? theme.permission : undefined}>{label}</Text></Text>
            {checkpoint ? <Text color={theme.subtle} wrap="truncate-end">  {changesLabel(codeChanges(checkpoint.id))}</Text> : null}
          </Box>
        );
      })}
      {below > 0 ? <Text color={theme.subtle}>  ↓ {below} more below</Text> : null}
    </OverlayFrame>
  );
};
