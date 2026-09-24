import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';
import { OverlayFrame } from './OverlayFrame.js';
import type { ThinkingLevelSetting } from '../agent/thinking.js';

interface Props {
  levels: ThinkingLevelSetting[];
  current: ThinkingLevelSetting;
  onSelect: (level: ThinkingLevelSetting, scope: 'default' | 'session') => void;
  onCancel: () => void;
  ruleLabel?: string;
}

const INDENT = 16;
const LABEL_GAP = 5;

/**
 * /effort as Claude Code 2.1.281 draws it: a track from "Faster" to "Smarter",
 * a ▲ over the chosen level, the current level in green and the highlighted
 * one in the suggestion colour. ←/→ move, Enter saves, s applies to the session.
 */
export const EffortDialog: React.FC<Props> = ({ levels, current, onSelect, onCancel, ruleLabel }) => {
  const theme = useTheme();
  const [index, setIndex] = useState(Math.max(0, levels.indexOf(current)));
  useRawInput((e) => {
    if (e.name === 'escape' || (e.name === 'char' && e.ctrl && e.text === 'c')) onCancel();
    else if (e.name === 'left') setIndex((i) => Math.max(0, i - 1));
    else if (e.name === 'right') setIndex((i) => Math.min(levels.length - 1, i + 1));
    else if (e.name === 'return') onSelect(levels[index], 'default');
    else if (e.name === 'char' && e.text === 's' && !e.ctrl && !e.alt) onSelect(levels[index], 'session');
  });

  // Claude Code sets the level names five columns apart; the track and "Smarter" end with the last one.
  const starts: number[] = [];
  levels.forEach((level, i) => starts.push(i === 0 ? 0 : starts[i - 1] + levels[i - 1].length + LABEL_GAP));
  const labelsWidth = (starts[starts.length - 1] ?? 0) + (levels[levels.length - 1]?.length ?? 0);
  const marker = starts[index] + Math.floor((levels[index]?.length ?? 1) / 2);
  const pad = ' '.repeat(INDENT);

  return (
    <OverlayFrame title="Effort" header={<Text bold>Effort</Text>} hint="←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel" ruleLabel={ruleLabel}>
      <Box flexDirection="column">
        <Text>{pad}Faster{' '.repeat(Math.max(1, labelsWidth - 'Faster'.length - 'Smarter'.length))}Smarter</Text>
        <Text>{pad}<Text color={theme.subtle}>{'─'.repeat(marker)}</Text><Text bold>▲</Text><Text color={theme.subtle}>{'─'.repeat(Math.max(0, labelsWidth - marker - 1))}</Text></Text>
        <Text>
          {pad}
          {levels.map((level, i) => {
            const gap = i === 0 ? starts[0] : starts[i] - starts[i - 1] - levels[i - 1].length;
            const isCurrent = level === current;
            const color = i === index && !isCurrent ? theme.permission : isCurrent ? theme.success : theme.subtle;
            return <Text key={level}>{' '.repeat(Math.max(1, gap) * (i === 0 ? 0 : 1))}<Text color={color} bold={i === index || isCurrent}>{level}</Text></Text>;
          })}
        </Text>
      </Box>
    </OverlayFrame>
  );
};
