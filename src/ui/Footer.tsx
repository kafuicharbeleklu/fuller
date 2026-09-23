import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import type { AgentStatus, PermissionMode, UsageInfo } from '../agent/types.js';
import { PLAY, PLAY_GAP, PAUSE, PAUSE_GAP } from './glyphs.js';

interface Props {
  mode: PermissionMode;
  status: AgentStatus;
  usage: UsageInfo;
  autoCompactThreshold: number;
  model: string;
  inputEmpty: boolean;
  bashMode: boolean;
}

export const Footer: React.FC<Props> = ({ mode, status, usage, autoCompactThreshold, model, inputEmpty, bashMode }) => {
  const theme = useTheme();
  const busy = status !== 'idle';

  let modeNode: React.ReactNode;
  if (bashMode) modeNode = <Text color={theme.bashBorder}>! bash mode</Text>;
  else if (mode === 'acceptEdits') modeNode = <Text color={theme.autoAccept}>{PLAY}{PLAY_GAP}accept edits on <Text color={theme.subtle}>(shift+tab to cycle)</Text></Text>;
  else if (mode === 'plan') modeNode = <Text color={theme.planMode}>{PAUSE}{PAUSE_GAP}plan mode on <Text color={theme.subtle}>(shift+tab to cycle)</Text></Text>;
  else if (mode === 'bypassPermissions') modeNode = <Text color={theme.bypass}>{PLAY}{PLAY_GAP}bypass permissions on <Text color={theme.subtle}>(shift+tab to cycle)</Text></Text>;
  else modeNode = <Text color={theme.subtle}>{busy ? 'esc to interrupt' : inputEmpty ? '? for shortcuts' : 'enter to send · \\⏎ for newline'}</Text>;

  const used = usage.promptTokens / usage.contextWindow;
  const left = Math.max(0, Math.round((autoCompactThreshold - used) / autoCompactThreshold * 100));
  const showContext = usage.promptTokens > 0;

  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Box>{modeNode}</Box>
      <Box>
        {showContext ? (
          <Text color={left < 20 ? theme.warning : theme.subtle}>Context left until auto-compact: {left}% · </Text>
        ) : null}
        <Text color={theme.subtle}>{model}</Text>
      </Box>
    </Box>
  );
};
