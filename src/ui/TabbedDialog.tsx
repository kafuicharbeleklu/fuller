import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';
import { OverlayFrame } from './OverlayFrame.js';

export interface DialogTab {
  label: string;
  content: React.ReactNode;
}

interface Props {
  title: string;
  tabs: DialogTab[];
  initialTab?: number;
  /** Rule, title and active tab colour. */
  color?: string;
  hint?: string;
  ruleLabel?: string;
  onClose: () => void;
}

/**
 * Claude Code 2.1.281 tabbed dialog (/help, /status, /usage): "Title  Tab  Tab"
 * with the active tab in black on the dialog colour; ←/→ or Tab switch tabs.
 */
export const TabbedDialog: React.FC<Props> = ({ title, tabs, initialTab = 0, color, hint = 'Esc to cancel', ruleLabel, onClose }) => {
  const theme = useTheme();
  const tint = color ?? theme.permission;
  const [tab, setTab] = useState(Math.max(0, Math.min(initialTab, tabs.length - 1)));
  useRawInput((e) => {
    if (e.name === 'escape' || (e.name === 'char' && e.ctrl && e.text === 'c')) onClose();
    else if (e.name === 'right' || (e.name === 'tab' && !e.shift)) setTab((t) => (t + 1) % tabs.length);
    else if (e.name === 'left' || (e.name === 'tab' && e.shift)) setTab((t) => (t - 1 + tabs.length) % tabs.length);
  });
  const header = (
    <Text wrap="truncate-end">
      <Text bold color={tint}>{title}</Text>
      {/* Each tab is " label ", one space apart; the active one on the dialog colour. */}
      {tabs.map((t, i) => (i === tab
        ? <Text key={t.label}>{' '}<Text bold color="black" backgroundColor={tint}>{` ${t.label} `}</Text></Text>
        : <Text key={t.label}>{' '}{` ${t.label} `}</Text>))}
    </Text>
  );
  return (
    <OverlayFrame title={title} header={header} color={tint} hint={hint} ruleLabel={ruleLabel}>
      <Box flexDirection="column">{tabs[tab]?.content}</Box>
    </OverlayFrame>
  );
};

/** "Key:" in bold padded to Claude Code's 19-column key width, then the value. */
export const KeyValue: React.FC<{ label: string; value?: React.ReactNode; placeholder?: string }> = ({ label, value, placeholder }) => {
  const theme = useTheme();
  return (
    <Text wrap="truncate-end">
      <Text bold>{`${label}:`.padEnd(19)}</Text>
      {value !== undefined && value !== '' ? value : <Text color={theme.subtle}>{placeholder ?? '—'}</Text>}
    </Text>
  );
};
