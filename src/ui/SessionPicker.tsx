import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';
import { formatRelative, type SessionMeta } from '../session/store.js';

interface Props {
  sessions: SessionMeta[];
  onSelect: (id: string) => void;
  onCancel: () => void;
}

export const SessionPicker: React.FC<Props> = ({ sessions, onSelect, onCancel }) => {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const filtered = sessions.filter((s) => !query || `${s.title ?? ''} ${s.id} ${s.gitBranch ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const safe = Math.min(index, Math.max(0, filtered.length - 1));

  useRawInput((e) => {
    if (e.name === 'escape' || (e.name === 'char' && e.ctrl && e.text === 'c')) onCancel();
    else if (e.name === 'up') setIndex((i) => Math.max(0, i - 1));
    else if (e.name === 'down') setIndex((i) => Math.min(filtered.length - 1, i + 1));
    else if (e.name === 'return') { const s = filtered[safe]; if (s) onSelect(s.id); }
    else if (e.name === 'backspace') setQuery((q) => q.slice(0, -1));
    else if (e.name === 'char' && !e.ctrl && !e.alt) { setQuery((q) => q + e.text); setIndex(0); }
  });

  const visible = filtered.slice(Math.max(0, safe - 6), Math.max(0, safe - 6) + 12);
  const offset = Math.max(0, safe - 6);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={theme.accent}>Resume a session</Text>
      <Text color={theme.subtle}>↑/↓ select · enter resume · esc start a new session · type to filter</Text>
      <Box marginTop={1}>
        <Text color={theme.accent}>❯ </Text>
        <Text>{query}</Text>
        <Text inverse> </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {filtered.length === 0 ? <Text color={theme.subtle}>No sessions found.</Text> : null}
        {visible.map((s, vi) => {
          const i = offset + vi;
          const selected = i === safe;
          return (
            <Box key={s.id}>
              <Text color={selected ? theme.accent : theme.subtle}>{selected ? '❯ ' : '  '}</Text>
              <Box width={10}><Text color={theme.subtle}>{formatRelative(s.updatedAt)}</Text></Box>
              <Text color={selected ? theme.text : theme.subtle} bold={selected} wrap="truncate-end">{s.title || '(untitled)'}</Text>
              <Text color={theme.subtle}>  {s.messageCount} msgs{s.gitBranch ? ` · ${s.gitBranch}` : ''} · {s.model}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
