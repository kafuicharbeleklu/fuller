import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';

export interface SelectItem<T = string> {
  label: string;
  value: T;
  /** Shown after the label column; wraps under it like Claude Code's descriptions. */
  hint?: React.ReactNode;
  color?: string;
  marker?: string;
}

interface SelectProps<T> {
  items: SelectItem<T>[];
  onSelect: (value: T, index: number) => void;
  onCancel?: () => void;
  isActive?: boolean;
  numbered?: boolean;
  initialIndex?: number;
  maxVisible?: number;
  labelWidth?: number;
  moreLabel?: string;
  shortcutKey?: string;
  onShortcutSelect?: (value: T, index: number) => void;
  onHighlight?: (value: T, index: number) => void;
}

export function Select<T = string>({ items, onSelect, onCancel, isActive = true, numbered = true, initialIndex = 0, maxVisible = 10, labelWidth, moreLabel = 'more', shortcutKey, onShortcutSelect, onHighlight }: SelectProps<T>) {
  const theme = useTheme();
  const [index, setIndex] = useState(Math.min(initialIndex, Math.max(0, items.length - 1)));
  const safeIndex = Math.max(0, Math.min(index, items.length - 1));
  const page = Math.max(1, maxVisible);
  const highlightedValue = items[safeIndex]?.value;
  useEffect(() => { if (highlightedValue !== undefined) onHighlight?.(highlightedValue, safeIndex); }, [safeIndex, highlightedValue]);

  useRawInput((e) => {
    if (!items.length) { if (e.name === 'escape') onCancel?.(); return; }
    if (e.name === 'up' || (e.name === 'char' && !e.alt && ((e.text === 'k' && !e.ctrl) || (e.text === 'p' && e.ctrl)))) setIndex((i) => (i <= 0 ? items.length - 1 : i - 1));
    else if (e.name === 'down' || (e.name === 'char' && !e.alt && ((e.text === 'j' && !e.ctrl) || (e.text === 'n' && e.ctrl)))) setIndex((i) => (i >= items.length - 1 ? 0 : i + 1));
    else if (e.name === 'pageup') setIndex((i) => Math.max(0, i - page));
    else if (e.name === 'pagedown') setIndex((i) => Math.min(items.length - 1, i + page));
    else if (e.name === 'home') setIndex(0);
    else if (e.name === 'end') setIndex(items.length - 1);
    else if (e.name === 'mouse' && e.mouse?.button === 64) setIndex((i) => Math.max(0, i - 1));
    else if (e.name === 'mouse' && e.mouse?.button === 65) setIndex((i) => Math.min(items.length - 1, i + 1));
    else if (e.name === 'return') { const it = items[safeIndex]; if (it) onSelect(it.value, safeIndex); }
    else if (e.name === 'escape' || (e.name === 'char' && e.ctrl && e.text === 'c')) onCancel?.();
    else if (e.name === 'char' && !e.ctrl && !e.alt && shortcutKey && e.text === shortcutKey) {
      const it = items[safeIndex];
      if (it) onShortcutSelect?.(it.value, safeIndex);
    }
    else if (numbered && e.name === 'char' && /^[1-9]$/.test(e.text)) {
      const n = parseInt(e.text, 10) - 1;
      if (n < items.length) { setIndex(n); onSelect(items[n].value, n); }
    }
  }, { isActive });

  const start = Math.max(0, Math.min(safeIndex - Math.floor(page / 2), items.length - page));
  const visible = items.slice(start, start + page);
  const hiddenBelow = Math.max(0, items.length - start - page);

  return (
    <Box flexDirection="column">
      {visible.map((it, vi) => {
        const i = start + vi;
        const selected = i === safeIndex;
        return (
          <Box key={i} flexDirection="row">
            {/* Claude Code: ❯ and a selected label in the permission colour, grey numbers, other labels in the text colour. */}
            <Box flexShrink={0}>
              <Text color={selected ? theme.permission : theme.subtle}>{selected ? '❯ ' : vi === 0 && start > 0 ? '↑ ' : '  '}</Text>
              {numbered ? <Text color={theme.subtle}>{i + 1}. </Text> : null}
            </Box>
            <Box width={labelWidth} flexShrink={labelWidth ? 0 : undefined}>
              <Text color={it.color ?? (selected ? theme.permission : undefined)} wrap="truncate-end">{it.label}{it.marker ? ` ${it.marker}` : ''}</Text>
            </Box>
            {it.hint ? <Box flexGrow={1} flexShrink={1} marginLeft={labelWidth ? 0 : 2}><Text color={theme.subtle} wrap="wrap">{it.hint}</Text></Box> : null}
          </Box>
        );
      })}
      {hiddenBelow > 0 ? <Text color={theme.subtle}>  … +{hiddenBelow} {hiddenBelow === 1 && moreLabel.endsWith('s') ? moreLabel.slice(0, -1) : moreLabel}</Text> : null}
    </Box>
  );
}
