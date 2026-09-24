import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from './theme.js';
import { modelLabel } from './modelLabel.js';
import { LOGOS, type LogoStyle } from './logos.js';
import { APP_NAME, APP_VERSION } from '../branding.js';

export interface BannerProps {
  model: string;
  workspaceDir: string;
  gitBranch?: string;
  gitDirty?: boolean;
  tip?: string;
  resumed?: string;
  memoryFiles?: string[];
  logoStyle?: LogoStyle;
  /** Replaces the model and directory lines (the agents view: model · dir, then counts). */
  lines?: [string, string];
}

/**
 * Startup banner laid out like Claude Code's: the logo, then name and
 * version, model and billing, working directory, and a tip on some launches. Branch
 * and instruction files are left to the footer, /status and /memory.
 */
export const Banner: React.FC<BannerProps> = ({ model, workspaceDir, tip, resumed, logoStyle = 'monogram', lines }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const home = process.env.HOME || '';
  const dir = home && workspaceDir.startsWith(home) ? '~' + workspaceDir.slice(home.length) : workspaceDir;
  const logo = LOGOS[logoStyle] ?? LOGOS.monogram;

  return (
    <Box flexDirection="column" width={Math.max(20, stdout.columns || 80)} marginTop={1} marginBottom={1}>
      <Box flexDirection="row">
        <Box flexDirection="column" width={11} flexShrink={0}>
          {logo.lines.map((line, i) => (
            <Text key={i} color={theme.accent}>{line}</Text>
          ))}
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Text wrap="truncate-end"><Text color={theme.text} bold>{APP_NAME}</Text><Text color={theme.subtle}> v{APP_VERSION}</Text></Text>
          <Text color={theme.subtle} wrap="truncate-end">{lines ? lines[0] : `${modelLabel(model)} · Gemini API`}</Text>
          <Text color={theme.subtle} wrap="truncate-middle">{lines ? lines[1] : dir}</Text>
        </Box>
      </Box>
      {tip ? (
        <Box marginTop={1} paddingLeft={2}>
          <Text color={theme.subtle} wrap="wrap">{tip}</Text>
        </Box>
      ) : null}
      {resumed ? <Text color={theme.subtle} wrap="truncate-end">↺ Resumed session {resumed}</Text> : null}
    </Box>
  );
};
