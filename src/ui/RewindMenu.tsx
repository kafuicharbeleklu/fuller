import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { Select } from './Select.js';
import type { Checkpoint } from '../checkpoint/manager.js';

interface Props {
  checkpoints: Checkpoint[];
  onRestore: (id: string) => void;
  onCancel: () => void;
}

export const RewindMenu: React.FC<Props> = ({ checkpoints, onRestore, onCancel }) => {
  const theme = useTheme();
  const items = checkpoints.slice(0, 15).map((c) => ({
    label: `${c.description}`,
    value: c.id,
    hint: `${new Date(c.timestamp).toLocaleTimeString()} · ${c.files.length} file${c.files.length === 1 ? '' : 's'}`,
  }));
  items.push({ label: 'Never mind', value: '__cancel__', hint: '' });
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1} marginTop={1}>
      <Text bold color={theme.accent}>Rewind — restore files to a checkpoint</Text>
      <Text color={theme.subtle}>Restores every file changed since the selected checkpoint (bash changes are not tracked).</Text>
      <Box marginTop={1}>
        {checkpoints.length === 0 ? (
          <Text color={theme.subtle}>No checkpoints yet.</Text>
        ) : null}
      </Box>
      <Select items={items} onSelect={(v) => (v === '__cancel__' ? onCancel() : onRestore(v))} onCancel={onCancel} numbered={false} />
    </Box>
  );
};
