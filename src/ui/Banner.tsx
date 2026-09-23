import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { APP_NAME, APP_VERSION, type Proverb } from '../branding.js';

export interface BannerProps {
  model: string;
  workspaceDir: string;
  gitBranch?: string;
  gitDirty?: boolean;
  proverb?: Proverb;
  tip?: string;
  resumed?: string;
}

export const Banner: React.FC<BannerProps> = ({ model, workspaceDir, gitBranch, gitDirty, tip, resumed }) => {
  const theme = useTheme();
  const home = process.env.HOME || '';
  const dir = home && workspaceDir.startsWith(home) ? '~' + workspaceDir.slice(home.length) : workspaceDir;
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
        <Box>
          <Text color={theme.accent} bold>✻ Welcome to {APP_NAME}</Text>
          <Text color={theme.subtle}> v{APP_VERSION}</Text>
        </Box>
        <Box marginTop={1}>
          {/* One Text node so the row wraps on narrow terminals instead of dropping segments. */}
          <Text color={theme.subtle}>
            model <Text color={theme.secondary}>{model}</Text> · {dir}
            {gitBranch ? <Text> · <Text color={theme.autoAccept}>{gitBranch}{gitDirty ? '*' : ''}</Text></Text> : null}
          </Text>
        </Box>
        <Box>
          <Text color={theme.subtle}>/help for commands · shift+tab to cycle modes · ? for shortcuts</Text>
        </Box>
      </Box>
      {resumed ? <Text color={theme.subtle}>  ↺ Resumed session {resumed}</Text> : null}
      {tip ? <Text color={theme.subtle}>  ※ Tip: {tip}</Text> : null}
    </Box>
  );
};
