import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { SPINNER_FRAMES, SPINNER_VERBS } from '../branding.js';
import { formatTokens } from '../tools/truncate.js';
import type { AgentStatus } from '../agent/types.js';

export function useSpinnerFrame(active: boolean, intervalMs = 120): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setI((x) => (x + 1) % SPINNER_FRAMES.length), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs]);
  return SPINNER_FRAMES[i];
}

interface SpinnerLineProps {
  status: AgentStatus;
  startedAt: number;
  responseTokens: number;
  verbs?: string[];
  frame: string;
}

export const SpinnerLine: React.FC<SpinnerLineProps> = ({ status, startedAt, responseTokens, verbs = SPINNER_VERBS, frame }) => {
  const theme = useTheme();
  const [elapsed, setElapsed] = useState(0);
  const [verbIndex, setVerbIndex] = useState(() => Math.floor(Math.random() * verbs.length));

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [startedAt]);

  useEffect(() => {
    const t = setInterval(() => setVerbIndex((v) => (v + 1 + Math.floor(Math.random() * 3)) % verbs.length), 4000);
    return () => clearInterval(t);
  }, [verbs.length]);

  if (status === 'idle' || status === 'awaiting_permission') return null;

  const verb =
    status === 'compacting' ? 'Compacting conversation'
    : status === 'running_tool' ? 'Running'
    : elapsed > 45 ? 'Deep in thought'
    : verbs[verbIndex] ?? 'Thinking';

  return (
    <Box>
      <Text color={theme.accent}>{frame} </Text>
      <Text color={theme.accent}>{verb}… </Text>
      <Text color={theme.subtle}>
        (esc to interrupt · {elapsed}s{responseTokens > 0 ? ` · ↓ ${formatTokens(responseTokens)} tokens` : ''})
      </Text>
    </Box>
  );
};
