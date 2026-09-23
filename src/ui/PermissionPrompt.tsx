import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';
import { DiffView } from './DiffView.js';
import { toolLabel } from '../tools/registry.js';
import type { PendingConfirmation } from '../agent/types.js';

interface Props {
  confirmation: PendingConfirmation;
  verbose: boolean;
  /** Keep the prompt shorter than the terminal so Ink never has to clear and redraw the whole screen. */
  maxDiffLines?: number;
}

export const PermissionPrompt: React.FC<Props> = ({ confirmation, verbose, maxDiffLines = 40 }) => {
  const theme = useTheme();
  const { toolCall, title, options, danger, onDecide } = confirmation;
  const [index, setIndex] = useState(0);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [feedback, setFeedback] = useState('');

  const choose = (i: number) => {
    const opt = options[i];
    if (!opt) return;
    if (opt.value === 'yes') onDecide({ kind: 'yes' });
    else if (opt.value === 'always') onDecide({ kind: 'always', rule: opt.rule ?? '' });
    else setFeedbackMode(true);
  };

  useRawInput((e) => {
    if (feedbackMode) {
      if (e.name === 'return' && !e.ctrl && !e.alt) { onDecide({ kind: 'no', feedback: feedback.trim() || undefined }); return; }
      if (e.name === 'escape') { onDecide({ kind: 'no' }); return; }
      if (e.name === 'backspace') { setFeedback((f) => f.slice(0, -1)); return; }
      if (e.name === 'char' && e.ctrl && e.text === 'c') { onDecide({ kind: 'no' }); return; }
      if (e.name === 'char' && !e.ctrl && !e.alt) setFeedback((f) => f + e.text);
      if (e.name === 'paste') setFeedback((f) => f + e.text.replace(/\r?\n/g, ' '));
      return;
    }
    if (e.name === 'up' || (e.name === 'char' && e.text === 'k')) setIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
    else if (e.name === 'down' || (e.name === 'char' && e.text === 'j')) setIndex((i) => (i >= options.length - 1 ? 0 : i + 1));
    else if (e.name === 'return') choose(index);
    else if (e.name === 'escape') onDecide({ kind: 'no' });
    else if (e.name === 'tab' && e.shift) { const i = options.findIndex((o) => o.switchMode); if (i >= 0) choose(i); }
    else if (e.name === 'char' && e.ctrl && e.text === 'c') onDecide({ kind: 'no' });
    else if (e.name === 'char' && /^[1-9]$/.test(e.text)) { const n = parseInt(e.text, 10) - 1; if (n < options.length) choose(n); }
    else if (e.name === 'char' && (e.text === 'y' || e.text === 'Y')) choose(0);
    else if (e.name === 'char' && (e.text === 'n' || e.text === 'N')) setFeedbackMode(true);
  });

  const label = toolLabel(toolCall.name);
  const borderColor = danger ? theme.error : theme.permission;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1} marginTop={1}>
      <Text bold color={borderColor}>{danger ? '⚠ ' : ''}{label === 'Bash' ? 'Bash command' : label === 'Edit' ? 'Edit file' : label === 'Write' ? 'Create file' : label === 'ExitPlanMode' ? 'Ready to code?' : label}</Text>
      {danger ? <Text color={theme.error}>{danger}</Text> : null}
      <Box flexDirection="column" marginTop={0} marginBottom={1}>
        {renderDetails()}
      </Box>
      <Text>{title}</Text>
      {feedbackMode ? (
        <Box flexDirection="column" marginTop={0}>
          <Text color={theme.subtle}>Tell Fuller what to do instead (enter to send, esc to just decline):</Text>
          <Box>
            <Text color={theme.accent}>❯ </Text>
            <Text>{feedback}</Text>
            <Text inverse> </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {options.map((o, i) => (
            <Box key={i}>
              <Text color={i === index ? theme.accent : theme.subtle}>{i === index ? '❯ ' : '  '}{i + 1}. </Text>
              <Text color={i === index ? theme.text : theme.subtle} bold={i === index}>{o.label}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );

  function renderDetails(): React.ReactNode {
    const { name, args } = toolCall;
    if (name === 'exit_plan_mode') {
      const lines = String(args.plan ?? '').split('\n').length;
      return <Text color={theme.subtle}>Fuller's plan ({lines} lines) is shown above. Approving leaves plan mode.</Text>;
    }
    if (name === 'execute_bash') {
      return (
        <Box flexDirection="column">
          <Text color={theme.text}>{String(args.command)}</Text>
          {args.description ? <Text color={theme.subtle}>{String(args.description)}</Text> : null}
        </Box>
      );
    }
    if ((name === 'edit_file' || name === 'write_file') && toolCall.diff) {
      return (
        <Box flexDirection="column">
          <Text bold>{String(args.file_path)}</Text>
          <DiffView diff={toolCall.diff} maxLines={maxDiffLines} />
        </Box>
      );
    }
    if (name === 'write_file') {
      const content = String(args.content ?? '');
      const lines = content.split('\n');
      return (
        <Box flexDirection="column">
          <Text bold>{String(args.file_path)}</Text>
          {lines.slice(0, Math.min(20, maxDiffLines)).map((l, i) => <Text key={i} color={theme.diffAdded}>+ {l}</Text>)}
          {lines.length > Math.min(20, maxDiffLines) ? <Text color={theme.subtle}>… +{lines.length - Math.min(20, maxDiffLines)} lines</Text> : null}
        </Box>
      );
    }
    if (name === 'web_fetch') return <Text>{String(args.url)}</Text>;
    return <Text color={theme.subtle}>{JSON.stringify(args).slice(0, 400)}</Text>;
  }
};
