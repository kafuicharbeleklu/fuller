import React from 'react';
import { Box, Text, useStdout } from 'ink';
import stringWidth from 'string-width';
import { useTheme } from './theme.js';

interface Props {
  title: string;
  /** Replaces the title line, e.g. a tab bar. */
  header?: React.ReactNode;
  /** Rule and title colour (Claude Code: permission colour, blue for Help). */
  color?: string;
  description?: string;
  hint?: string;
  /** Text set into the top rule near its right end, e.g. the effort in /model. */
  ruleLabel?: string;
  children: React.ReactNode;
}

/**
 * Open terminal panel used by interactive pickers, laid out like Claude Code
 * 2.1.281 dialogs: a `▔` rule and a bold title in the permission colour, then
 * the description, the content and the key hint, without blank lines.
 */
export const OverlayFrame: React.FC<Props> = ({ title, header, color, description, hint, ruleLabel, children }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = Math.max(1, (stdout.columns || 80) - 1);
  const paddingLeft = width < 28 ? 1 : 3;
  const compact = (stdout.rows || 24) < 16;
  const label = ruleLabel && stringWidth(ruleLabel) + 4 < width ? ` ${ruleLabel} ` : '';
  const ruleStart = '▔'.repeat(Math.max(0, width - stringWidth(label) - (label ? 1 : 0)));

  return (
    <Box flexDirection="column" marginTop={compact ? 0 : 1} width={width}>
      <Text color={color ?? theme.permission}>{ruleStart}{label ? <><Text color={theme.subtle}>{label}</Text>▔</> : null}</Text>
      <Box flexDirection="column" paddingLeft={paddingLeft} paddingRight={width < 28 ? 0 : 1}>
        {header ?? <Text bold color={color ?? theme.permission} wrap="truncate-end">{title}</Text>}
        {description ? <Text color={theme.subtle} wrap="wrap">{description}</Text> : null}
        <Box flexDirection="column">{children}</Box>
        {hint ? <Text color={theme.subtle} wrap="truncate-end">{hint}</Text> : null}
      </Box>
    </Box>
  );
};
