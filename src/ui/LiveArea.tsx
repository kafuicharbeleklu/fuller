import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from './theme.js';
import { ToolRow } from './ToolRow.js';
import type { LiveTurn } from '../agent/types.js';
import wrapAnsi from 'wrap-ansi';
import { TEXT_BULLET } from './glyphs.js';

interface Props {
  live: LiveTurn;
  verbose: boolean;
  frame: string;
  maxLines: number;
  permissionOpen?: boolean;
}

/** Streaming text (tail only, so the dynamic region stays smaller than the terminal) + running tools. */
export const LiveArea: React.FC<Props> = ({ live, verbose, frame, maxLines, permissionOpen = false }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const columns = Math.max(20, (stdout?.columns ?? 80) - 4);

  let tail: string[] = [];
  let hidden = 0;
  if (live.text) {
    // Budget physical rows, including a single paragraph longer than the screen.
    // Picking whole logical lines allowed that last paragraph to overflow Ink's
    // viewport and trigger a clear + replay of the entire transcript.
    const wrapped = wrapAnsi(live.text.replace(/\s+$/, ''), columns, { hard: true, trim: false }).split('\n');
    tail = wrapped.slice(-Math.max(1, maxLines));
    hidden = wrapped.length - tail.length;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {live.text ? (
        <Box>
          <Text color={theme.text}>{TEXT_BULLET} </Text>
          <Box flexDirection="column" flexGrow={1}>
            {hidden > 0 ? <Text color={theme.subtle}>… {hidden} earlier lines</Text> : null}
            {tail.map((l, i) => <Text key={i}>{l || ' '}</Text>)}
          </Box>
        </Box>
      ) : null}
      {live.tools.map((t) => (
        <Box key={t.id} marginTop={live.text ? 1 : 0}>
          <ToolRow toolCall={t} verbose={verbose} frame={frame} elapsedMs={t.startTime ? Date.now() - t.startTime : undefined} permissionOpen={permissionOpen} />
        </Box>
      ))}
    </Box>
  );
};
