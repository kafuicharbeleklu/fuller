import React, { useEffect, useState } from 'react';
import fs from 'node:fs';
import { Box, Text, useStdout } from 'ink';
import { ThemeProvider, useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';
import { Markdown } from './Markdown.js';
import { renderToString } from './renderToString.js';
import { previousGrapheme } from './textInput.js';
import { editFileExternally, editPromptExternally, editorName, tildePath } from './externalEditor.js';
import { APP_NAME } from '../branding.js';
import type { PendingConfirmation } from '../agent/types.js';

interface Props {
  confirmation: PendingConfirmation;
  /** Rows the plan may take: a longer plan scrolls (PgUp/PgDn, wheel) so the dialog never outgrows the terminal. */
  maxPlanLines?: number;
  /** Redraw everything after the external editor used the terminal. */
  onClearScreen?: () => void;
}

/**
 * The plan approval dialog, as Claude Code 2.1.283 draws it (capture 4.6): "Ready to code?", the plan
 * between dashed rules, then "Would you like to proceed?" with two ways to approve and a comment field
 * ("Tell Fuller what to change"). Esc rejects the plan and ends the turn; Shift+Tab approves with the
 * comment; Ctrl+G opens the plan file in the editor and the edited plan is the one approved.
 */
export const PlanApproval: React.FC<Props> = ({ confirmation, maxPlanLines = 20, onClearScreen }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const columns = Math.max(20, stdout?.columns ?? 80);
  const { options, onDecide } = confirmation;
  const file = confirmation.plan?.file;
  const original = confirmation.plan?.text ?? String(confirmation.toolCall.args.plan ?? '');
  const [plan, setPlan] = useState(original);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [scroll, setScroll] = useState(0);
  const [saved, setSaved] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 5000);
    return () => clearTimeout(timer);
  }, [saved]);

  const inputIndex = options.findIndex((o) => o.value === 'no');
  const onInput = index === inputIndex;
  const width = Math.max(10, columns - 2);
  // The plan's rows, laid out by Markdown in a separate Ink root. That nested render yields nothing inside
  // React's render phase (see useTranscriptRows), so it runs from a macrotask; plain lines meanwhile.
  const [rows, setRows] = useState<string[]>(() => plan.split('\n'));
  useEffect(() => {
    setRows(plan.split('\n'));
    const handle = setImmediate(() => {
      const text = renderToString(<ThemeProvider theme={theme}><Markdown content={plan} width={width} /></ThemeProvider>, width, 1000);
      if (text) setRows(text.split('\n'));
    });
    return () => clearImmediate(handle);
  }, [plan, width, theme]);
  const visible = Math.max(3, maxPlanLines);
  const maxScroll = Math.max(0, rows.length - visible);
  const top = Math.min(scroll, maxScroll);
  const shown = rows.slice(top, top + visible);
  const below = rows.length - top - shown.length;

  const edited = () => (plan !== original ? { plan } : {});
  const choose = (i: number) => {
    const option = options[i];
    if (!option) return;
    const comment = feedback.trim() || undefined;
    const extra = { ...(comment ? { feedback: comment } : {}), ...edited() };
    if (option.value === 'yes') onDecide({ kind: 'yes', ...extra });
    else if (option.value === 'always') onDecide({ kind: 'always', rule: '', ...extra });
    // The comment field needs a comment: Enter on an empty one does nothing, as in Claude Code.
    else if (comment) onDecide({ kind: 'no', ...extra });
  };

  const openEditor = () => {
    const wasRaw = process.stdin.isRaw;
    try {
      if (wasRaw) process.stdin.setRawMode(false);
      let next: string;
      if (file) {
        fs.writeFileSync(file, `${plan}\n`, 'utf8');
        editFileExternally(file);
        next = fs.readFileSync(file, 'utf8');
      } else next = editPromptExternally(plan);
      next = next.replace(/\s+$/, '');
      if (next) { setPlan(next); setSaved(true); setScroll(0); }
      setEditorError(null);
    } catch (error: any) {
      setEditorError(`Editor: ${error?.message ?? String(error)}`);
    } finally {
      if (wasRaw) process.stdin.setRawMode(true);
      onClearScreen?.();
    }
  };

  useRawInput((e) => {
    const last = options.length - 1;
    if (e.name === 'escape' || (e.name === 'char' && e.ctrl && e.text === 'c')) { onDecide({ kind: 'no', ...edited() }); return; }
    if (e.name === 'char' && e.ctrl && e.text === 'g') { openEditor(); return; }
    // Shift+Tab approves with the first option and whatever is typed in the comment field.
    if (e.name === 'tab' && e.shift) { choose(0); return; }
    if (e.name === 'return' && !e.alt) { choose(index); return; }
    if (e.name === 'up' || (e.name === 'char' && e.ctrl && e.text === 'p')) { setIndex((i) => (i <= 0 ? last : i - 1)); return; }
    if (e.name === 'down' || (e.name === 'char' && e.ctrl && e.text === 'n')) { setIndex((i) => (i >= last ? 0 : i + 1)); return; }
    if (e.name === 'pageup') { setScroll(Math.max(0, top - visible)); return; }
    if (e.name === 'pagedown') { setScroll(Math.min(maxScroll, top + visible)); return; }
    if (e.name === 'mouse' && e.mouse?.button === 64) { setScroll(Math.max(0, top - 3)); return; }
    if (e.name === 'mouse' && e.mouse?.button === 65) { setScroll(Math.min(maxScroll, top + 3)); return; }
    if (onInput) {
      if (e.name === 'backspace') setFeedback((f) => f.slice(0, previousGrapheme(f, f.length)));
      else if (e.name === 'char' && e.ctrl && e.text === 'u') setFeedback('');
      else if (e.name === 'char' && !e.ctrl && !e.alt) setFeedback((f) => f + e.text);
      else if (e.name === 'paste') setFeedback((f) => f + e.text.replace(/\r?\n/g, ' '));
      return;
    }
    if (e.name === 'home') setIndex(0);
    else if (e.name === 'end') setIndex(last);
    else if (e.name === 'char' && !e.ctrl && !e.alt && e.text === 'k') setIndex((i) => (i <= 0 ? last : i - 1));
    else if (e.name === 'char' && !e.ctrl && !e.alt && e.text === 'j') setIndex((i) => (i >= last ? 0 : i + 1));
    else if (e.name === 'char' && !e.ctrl && !e.alt && /^[1-9]$/.test(e.text)) {
      const n = parseInt(e.text, 10) - 1;
      if (n === inputIndex) setIndex(n);
      else if (n < options.length) choose(n);
    }
  });

  const dashes = <Text color={theme.userPrompt ?? theme.subtle}>{'╌'.repeat(columns)}</Text>;
  const rule = <Text color={theme.planMode}>{'─'.repeat(columns)}</Text>;
  return (
    <Box flexDirection="column" marginTop={1} width={columns}>
      {rule}
      <Text bold color={theme.permission}> Ready to code?</Text>
      <Text> </Text>
      <Text color={theme.text}> Here is {APP_NAME}'s plan:</Text>
      {dashes}
      {top > 0 ? <Text color={theme.subtle}> ↑ {top} more {top === 1 ? 'line' : 'lines'} (PgUp)</Text> : null}
      {shown.map((line, i) => <Text key={top + i} wrap="truncate-end"> {line}</Text>)}
      {below > 0 ? <Text color={theme.subtle}> ↓ {below} more {below === 1 ? 'line' : 'lines'} (PgDn)</Text> : null}
      {dashes}
      <Text> </Text>
      {rule}
      <Text color={theme.subtle}> {confirmation.title}</Text>
      <Text> </Text>
      {options.map((option, i) => {
        const selected = i === index;
        const pointer = <Text color={selected ? theme.permission : theme.subtle}>{selected ? ' ❯ ' : '   '}</Text>;
        const number = <Text color={theme.subtle}>{i + 1}. </Text>;
        if (i === inputIndex) {
          return (
            <Box key={i} flexDirection="column">
              <Box>
                {pointer}{number}
                <Box flexShrink={1}>
                  {feedback
                    ? <Text color={theme.text} wrap="wrap">{feedback}{selected ? <Text inverse> </Text> : null}</Text>
                    : <Text dimColor>Tell {APP_NAME} what to change</Text>}
                </Box>
              </Box>
              <Text color={theme.subtle}>      shift+tab to approve with this feedback</Text>
            </Box>
          );
        }
        return (
          <Box key={i}>
            {pointer}{number}
            <Text color={selected ? theme.permission : theme.text}>{option.label}</Text>
          </Box>
        );
      })}
      <Text> </Text>
      <Text>
        <Text color={theme.subtle}> ctrl+g to edit in {editorName()}{file ? ` · ${tildePath(file)}` : ''}</Text>
        {saved ? <><Text color={theme.subtle}> · </Text><Text color={theme.success}>✔ Plan saved!</Text></> : null}
      </Text>
      {editorError ? <Text color={theme.warning}> {editorError}</Text> : null}
    </Box>
  );
};
