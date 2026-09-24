import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import wrapAnsi from 'wrap-ansi';
import { useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';

interface Props {
  question: string;
  ask: (question: string, onChunk: (text: string) => void, signal: AbortSignal) => Promise<string>;
  onCopy: (text: string) => void;
  /** f: fork the question into a background agent. */
  onFork?: (question: string) => void;
  onClose: () => void;
  ruleLabel?: string;
}

/**
 * /btw as Claude Code 2.1.281 shows it: a panel over the prompt with "/btw" and
 * the question, "✻ Answering…" while it waits, then the answer. Nothing is
 * added to the conversation; Esc closes (and cancels a pending answer), f
 * forks the question into a background agent.
 */
export const BtwPanel: React.FC<Props> = ({ question, ask, onCopy, onFork, onClose, ruleLabel }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const [answer, setAnswer] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [top, setTop] = useState(0);
  const [copied, setCopied] = useState(false);
  const abort = useRef(new AbortController());

  useEffect(() => {
    let text = '';
    ask(question, (chunk) => { text += chunk; setAnswer(text); }, abort.current.signal)
      .then((full) => { setAnswer(full || text); setDone(true); })
      .catch((err) => { if (!abort.current.signal.aborted) { setError(err?.message ?? String(err)); setDone(true); } });
    return () => abort.current.abort();
  }, [question]);

  const width = Math.max(20, (stdout.columns || 80) - 8);
  const lines = wrapAnsi(answer.trim(), width, { hard: true }).split('\n');
  const page = Math.max(3, (stdout.rows || 24) - 10);
  const maxTop = Math.max(0, lines.length - page);

  useRawInput((e) => {
    if (e.name === 'escape' || (e.name === 'char' && e.ctrl && e.text === 'c')) { abort.current.abort(); onClose(); }
    else if (e.name === 'up') setTop((t) => Math.max(0, t - 1));
    else if (e.name === 'down') setTop((t) => Math.min(maxTop, t + 1));
    else if (e.name === 'char' && e.text === 'c' && done && answer) { onCopy(answer); setCopied(true); }
    else if (e.name === 'char' && e.text === 'f' && done && onFork) { abort.current.abort(); onFork(question); }
  });

  const rule = Math.max(1, (stdout.columns || 80) - 1);
  const label = ruleLabel ? ` ${ruleLabel} ` : '';
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.permission}>{'▔'.repeat(Math.max(0, rule - label.length - (label ? 1 : 0)))}{label ? <><Text color={theme.subtle}>{label}</Text>▔</> : null}</Text>
      <Box flexDirection="column" paddingLeft={4}>
        <Text wrap="truncate-end"><Text bold color={theme.warning}>/btw </Text><Text color={theme.subtle}>{question}</Text></Text>
        <Box flexDirection="column" paddingLeft={2}>
          {error ? <Text color={theme.error}>{error}</Text>
            : answer ? lines.slice(top, top + page).map((line, i) => <Text key={i}>{line || ' '}</Text>)
            : <Text color={theme.warning}>✻ Answering…</Text>}
        </Box>
        <Text color={theme.subtle}>{done ? `↑/↓ to scroll · c to ${copied ? 'copy (copied)' : 'copy'}${onFork ? ' · f to fork' : ''} · Esc to close` : 'Esc to close'}</Text>
      </Box>
    </Box>
  );
};
