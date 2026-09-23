import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';

export interface SelectItem<T = string> {
  label: string;
  value: T;
  hint?: string;
  color?: string;
}

interface SelectProps<T> {
  items: SelectItem<T>[];
  onSelect: (value: T, index: number) => void;
  onCancel?: () => void;
  isActive?: boolean;
  numbered?: boolean;
  initialIndex?: number;
  maxVisible?: number;
}

export function Select<T = string>({ items, onSelect, onCancel, isActive = true, numbered = true, initialIndex = 0, maxVisible = 10 }: SelectProps<T>) {
  const theme = useTheme();
  const [index, setIndex] = useState(Math.min(initialIndex, Math.max(0, items.length - 1)));

  useRawInput((e) => {
    if (e.name === 'up' || (e.name === 'char' && e.text === 'k' && !e.ctrl)) setIndex((i) => (i <= 0 ? items.length - 1 : i - 1));
    else if (e.name === 'down' || (e.name === 'char' && e.text === 'j' && !e.ctrl)) setIndex((i) => (i >= items.length - 1 ? 0 : i + 1));
    else if (e.name === 'return') { const it = items[index]; if (it) onSelect(it.value, index); }
    else if (e.name === 'escape' || (e.name === 'char' && e.ctrl && e.text === 'c')) onCancel?.();
    else if (numbered && e.name === 'char' && /^[1-9]$/.test(e.text)) {
      const n = parseInt(e.text, 10) - 1;
      if (n < items.length) { setIndex(n); onSelect(items[n].value, n); }
    }
  }, { isActive });

  const start = Math.max(0, Math.min(index - Math.floor(maxVisible / 2), items.length - maxVisible));
  const visible = items.slice(start, start + maxVisible);

  return (
    <Box flexDirection="column">
      {start > 0 ? <Text color={theme.subtle}>  ↑ {start} more</Text> : null}
      {visible.map((it, vi) => {
        const i = start + vi;
        const selected = i === index;
        return (
          <Box key={i}>
            <Text color={selected ? theme.accent : theme.subtle}>{selected ? '❯ ' : '  '}</Text>
            {numbered ? <Text color={selected ? theme.accent : theme.subtle}>{i + 1}. </Text> : null}
            <Text color={selected ? (it.color ?? theme.text) : (it.color ?? theme.subtle)} bold={selected}>{it.label}</Text>
            {it.hint ? <Text color={theme.subtle}>  {it.hint}</Text> : null}
          </Box>
        );
      })}
      {start + maxVisible < items.length ? <Text color={theme.subtle}>  ↓ {items.length - start - maxVisible} more</Text> : null}
    </Box>
  );
}
