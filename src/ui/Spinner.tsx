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
  /** No shimmer and no verb rotation. */
  reducedMotion?: boolean;
}

export const SpinnerLine: React.FC<SpinnerLineProps> = ({ status, startedAt, responseTokens, verbs = SPINNER_VERBS, frame, reducedMotion = false }) => {
  const theme = useTheme();
  const [elapsed, setElapsed] = useState(0);
  const [verbIndex, setVerbIndex] = useState(() => Math.floor(Math.random() * verbs.length));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const t = setInterval(() => setTick((x) => x + 1), 120);
    return () => clearInterval(t);
  }, [reducedMotion]);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [startedAt]);

  // The thinking tiers count the model call in progress, not the whole turn: a turn of 150 tool
  // calls showed "Deep in thought… (517s · thinking)" on every call (real session, 25/09).
  const [thinkingSince, setThinkingSince] = useState(() => Date.now());
  useEffect(() => { setThinkingSince(Date.now()); }, [status]);
  const callElapsed = Math.floor((Date.now() - thinkingSince) / 1000);

  useEffect(() => {
    if (reducedMotion) return;
    const t = setInterval(() => setVerbIndex((v) => (v + 1 + Math.floor(Math.random() * 3)) % verbs.length), 4000);
    return () => clearInterval(t);
  }, [verbs.length, reducedMotion]);

  if (status === 'idle' || status === 'awaiting_permission') return null;

  const verb =
    status === 'compacting' ? 'Compacting conversation'
    : status === 'retrying' ? 'Waiting to retry'
    : status === 'running_tool' ? 'Running'
    : verbs[verbIndex] ?? 'Thinking';

  // Claude Code shows the timer only once the wait gets noticeable, then what the model is doing.
  const detail = status === 'thinking' ? thinkingTier(callElapsed) : responseTokens > 0 ? `↓ ${formatTokens(responseTokens)} tokens` : '';
  const showTimer = elapsed >= SPINNER_TIMER_AFTER_S;

  return (
    <Box>
      <Text color={theme.accent}>{frame} </Text>
      {reducedMotion ? <Text color={theme.accent}>{verb}…</Text> : <ShimmerText text={`${verb}…`} tick={tick} />}
      {showTimer ? <Text color={theme.subtle}> ({elapsed}s{detail ? ` · ${detail}` : ''})</Text> : null}
    </Box>
  );
};

/**
 * What the model is doing, by how long the current call has been thinking: Claude Code 2.1.282's
 * tiers, read in its binary (10, 20, 30 and 45 s). "deep in thought" is this detail, not the verb.
 */
export function thinkingTier(seconds: number): string {
  if (seconds >= 45) return 'deep in thought';
  if (seconds >= 30) return 'thinking some more';
  if (seconds >= 20) return 'thinking more';
  if (seconds >= 10) return 'still thinking';
  return 'thinking';
}

/** Seconds before the spinner shows its timer (Claude Code: none at 4 s, shown at 6 s). */
export const SPINNER_TIMER_AFTER_S = 5;

/** `color` mixed with white (hex colours), or its bright ANSI variant; the spinner glint. */
export function lighten(color: string, amount = 0.45): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return /^[a-z]+$/.test(color) && !color.endsWith('Bright') ? `${color}Bright` : color;
  const mix = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount) + 255 * amount).toString(16).padStart(2, '0');
  return `#${mix(0)}${mix(2)}${mix(4)}`;
}

/** The verb in the accent colour with a lighter glint sweeping across it, like Claude Code's shimmer. */
const ShimmerText: React.FC<{ text: string; tick: number }> = ({ text, tick }) => {
  const theme = useTheme();
  const chars = [...text];
  const span = chars.length + 6;
  const at = (tick % span) - 3;
  const glint = lighten(theme.accent);
  return (
    <Text color={theme.accent}>
      {chars.map((ch, i) => (Math.abs(i - at) <= 1 ? <Text key={i} color={glint}>{ch}</Text> : ch))}
    </Text>
  );
};
