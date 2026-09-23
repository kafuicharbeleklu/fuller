import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from './theme.js';
import { ToolRow } from './ToolRow.js';
import type { LiveTurn } from '../agent/types.js';
import { BULLET, BULLET_GAP } from './glyphs.js';

interface Props {
  live: LiveTurn;
  verbose: boolean;
  frame: string;
  maxLines: number;
}

/** Streaming text (tail only, so the dynamic region stays smaller than the terminal) + running tools. */
export const LiveArea: React.FC<Props> = ({ live, verbose, frame, maxLines }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const columns = Math.max(20, (stdout?.columns ?? 80) - 4);

  let tail: string[] = [];
  let hidden = 0;
  if (live.text) {
    const logical = live.text.replace(/\s+$/, '').split('\n');
    let budget = Math.max(3, maxLines);
    const picked: string[] = [];
    for (let i = logical.length - 1; i >= 0 && budget > 0; i--) {
      const rows = Math.max(1, Math.ceil((logical[i].length || 1) / columns));
      if (rows > budget && picked.length > 0) break;
      budget -= rows;
      picked.unshift(logical[i]);
    }
    tail = picked;
    hidden = logical.length - picked.length;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {live.text ? (
        <Box>
          <Text color={theme.accent}>{BULLET}{BULLET_GAP}</Text>
          <Box flexDirection="column" flexGrow={1}>
            {hidden > 0 ? <Text color={theme.subtle}>… {hidden} earlier lines</Text> : null}
            {tail.map((l, i) => <Text key={i}>{l || ' '}</Text>)}
          </Box>
        </Box>
      ) : null}
      {live.tools.map((t) => (
        <Box key={t.id} marginTop={live.text ? 1 : 0}>
          <ToolRow toolCall={t} verbose={verbose} frame={frame} elapsedMs={t.startTime ? Date.now() - t.startTime : undefined} />
        </Box>
      ))}
    </Box>
  );
};
