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
  /** False: the content starts right under the title (Claude Code's /resume, its search box). */
  gap?: boolean;
  children: React.ReactNode;
}

/**
 * Open terminal panel used by interactive pickers, laid out like Claude Code's dialog component
 * (read in the 2.1.283 binary, 26/09): a `▔` rule, the bold title in the permission colour with its
 * description right under it, a blank line, the content, a blank line and the key hint, dim and
 * italic. The 24/09 comparison had dropped the blank lines from the captures before comparing;
 * a terminal under 16 rows still gets the compact layout.
 */
export const OverlayFrame: React.FC<Props> = ({ title, header, color, description, hint, ruleLabel, gap = true, children }) => {
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
        <Box flexDirection="column" marginTop={compact || !gap ? 0 : 1}>{children}</Box>
        {hint ? <Box marginTop={compact ? 0 : 1}><Text color={theme.subtle} italic wrap="truncate-end">{hint}</Text></Box> : null}
      </Box>
    </Box>
  );
};
