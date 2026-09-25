import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from './theme.js';
import { Select } from './Select.js';
import { APP_NAME } from '../branding.js';

/**
 * Claude Code 2.1.282's workspace trust dialog, shown before anything of an untrusted folder is
 * loaded. "No, exit" is selected first; Esc also exits.
 */
export const TrustDialog: React.FC<{ folder: string; onDecide: (trusted: boolean) => void }> = ({ folder, onDecide }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = Math.max(20, (stdout.columns || 80) - 1);
  return (
    <Box flexDirection="column" width={width}>
      <Text color={theme.warning}>{'─'.repeat(width)}</Text>
      <Box flexDirection="column" paddingX={1}>
        <Text bold color={theme.warning}>Accessing workspace:</Text>
        <Text> </Text>
        <Text bold>{folder}</Text>
        <Text> </Text>
        <Text wrap="wrap">Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in this folder first.</Text>
        <Text> </Text>
        <Text wrap="wrap">{APP_NAME} will be able to read, edit, and execute files here.</Text>
        <Text> </Text>
        <Select
          items={[{ label: 'No, exit', value: false }, { label: 'Yes, I trust this folder', value: true }]}
          numbered={false}
          onSelect={(trusted) => onDecide(trusted)}
          onCancel={() => onDecide(false)}
        />
        <Text> </Text>
        <Text color={theme.subtle}>Enter to confirm · Esc to cancel</Text>
      </Box>
    </Box>
  );
};
