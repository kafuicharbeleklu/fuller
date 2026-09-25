import React, { useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';
import { DiffView } from './DiffView.js';
import { previousGrapheme } from './textInput.js';
import type { PendingConfirmation, PermissionOption } from '../agent/types.js';

interface Props {
  confirmation: PendingConfirmation;
  verbose: boolean;
  /** Keep the prompt shorter than the terminal so Ink never has to clear and redraw the whole screen. */
  maxDiffLines?: number;
}

/** `code` spans in option labels are shown in bold, like Claude Code's command and path names. */
function renderLabel(label: string): React.ReactNode[] {
  return label.split('`').map((part, i) => (i % 2 ? <Text key={i} bold>{part}</Text> : <Text key={i}>{part}</Text>));
}

/** The question with the file name in bold, as Claude Code writes "make this edit to **README.md**?". */
function boldFile(title: string, file: string): React.ReactNode {
  const at = file ? title.lastIndexOf(file) : -1;
  if (at < 0) return title;
  return <>{title.slice(0, at)}<Text bold>{file}</Text>{title.slice(at + file.length)}</>;
}

/** Placeholder shown after "Yes, " or "No, " while the comment field is open (Tab to amend). */
function amendPlaceholder(toolName: string, option: PermissionOption): string {
  if (option.value === 'yes') return 'and tell Fuller what to do next';
  return toolName === 'exit_plan_mode' ? 'and tell Fuller what to change' : 'and tell Fuller what to do differently';
}

export const PermissionPrompt: React.FC<Props> = ({ confirmation, verbose, maxDiffLines = 40 }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const height = stdout?.rows ?? 24;
  const columns = stdout?.columns ?? 80;
  const compact = height < 20;
  const tiny = height < 16;
  const { toolCall, title, options, danger, note, onDecide } = confirmation;
  const [index, setIndex] = useState(0);
  const [amending, setAmending] = useState(false);
  const [comments, setComments] = useState<Record<number, string>>({});
  const feedback = comments[index] ?? '';
  const setFeedback = (update: (text: string) => string) => setComments((value) => ({ ...value, [index]: update(value[index] ?? '') }));
  // Only a plain Yes or No can carry a comment, as in Claude Code; web fetches never do.
  const canAmend = (i: number) => {
    const option = options[i];
    if (!option || toolCall.name === 'web_fetch') return false;
    if (toolCall.name === 'exit_plan_mode') return option.value === 'no';
    return option.value === 'no' || (option.value === 'yes' && !option.switchMode);
  };

  const choose = (i: number) => {
    const opt = options[i];
    if (!opt) return;
    const comment = comments[i]?.trim() || undefined;
    if (opt.value === 'yes') onDecide({ kind: 'yes', ...(comment ? { feedback: comment } : {}) });
    else if (opt.value === 'always') onDecide({ kind: 'always', rule: opt.rule ?? '', ...(opt.rules ? { rules: opt.rules } : {}) });
    else if (toolCall.name === 'exit_plan_mode' && !amending && !comment) { setIndex(i); setAmending(true); }
    else onDecide({ kind: 'no', ...(comment ? { feedback: comment } : {}) });
  };

  const move = (next: (i: number) => number) => {
    setAmending(false);
    setIndex((i) => next(i));
  };

  useRawInput((e) => {
    const last = options.length - 1;
    if (e.name === 'escape' || (e.name === 'char' && e.ctrl && e.text === 'c')) { onDecide({ kind: 'no' }); return; }
    if (e.name === 'return' && !e.alt) { choose(index); return; }
    if (e.name === 'up' || (e.name === 'char' && e.ctrl && e.text === 'p')) { move((i) => (i <= 0 ? last : i - 1)); return; }
    if (e.name === 'down' || (e.name === 'char' && e.ctrl && e.text === 'n')) { move((i) => (i >= last ? 0 : i + 1)); return; }
    if (amending) {
      // Tab and Shift+Tab close the field and keep what was typed.
      if (e.name === 'tab') { setAmending(false); return; }
      if (e.name === 'backspace') { setFeedback((f) => f.slice(0, previousGrapheme(f, f.length))); return; }
      if (e.name === 'char' && e.ctrl && e.text === 'u') { setFeedback(() => ''); return; }
      if (e.name === 'char' && !e.ctrl && !e.alt) setFeedback((f) => f + e.text);
      if (e.name === 'paste') setFeedback((f) => f + e.text.replace(/\r?\n/g, ' '));
      return;
    }
    if (e.name === 'home') setIndex(0);
    else if (e.name === 'end') setIndex(last);
    else if (e.name === 'char' && !e.ctrl && !e.alt && e.text === 'k') setIndex((i) => (i <= 0 ? last : i - 1));
    else if (e.name === 'char' && !e.ctrl && !e.alt && e.text === 'j') setIndex((i) => (i >= last ? 0 : i + 1));
    else if (e.name === 'tab' && !e.shift && canAmend(index)) setAmending(true);
    else if (e.name === 'tab' && e.shift) { const i = options.findIndex((o) => o.switchMode); if (i >= 0) choose(i); }
    else if (e.name === 'char' && !e.ctrl && !e.alt && /^[1-9]$/.test(e.text)) { const n = parseInt(e.text, 10) - 1; if (n < options.length) choose(n); }
  });

  const heading = toolCall.name === 'execute_bash' ? 'Bash command'
    : toolCall.name === 'edit_file' ? 'Edit file'
    : toolCall.name === 'write_file' ? 'Write file'
    : toolCall.name === 'web_fetch' ? 'Fetch'
    : toolCall.name === 'read_file' || toolCall.name === 'outline_file' ? 'Read file'
    : toolCall.name === 'list_directory' ? 'List directory'
    : toolCall.name === 'search_files' || toolCall.name === 'glob' ? 'Search'
    : toolCall.name === 'exit_plan_mode' ? 'Ready to code?' : 'Tool use';
  const gap = !compact ? <Text> </Text> : null;
  const fileDiff = (toolCall.name === 'edit_file' || toolCall.name === 'write_file') && toolCall.diff ? toolCall.diff : undefined;
  const footer = amending || !canAmend(index) ? 'Esc to cancel' : 'Esc to cancel · Tab to amend';

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      width={Math.max(20, columns)}
      borderStyle="single"
      borderLeft={false}
      borderRight={false}
      borderBottom={false}
      borderColor={theme.permission}
      paddingX={1}
    >
      <Text bold color={theme.permission}>{heading}</Text>
      {fileDiff ? (
        // Claude Code: file name in grey, then the diff between dashed rules across the full width.
        <Box flexDirection="column" marginLeft={-1} width={Math.max(20, columns)}>
          <Text color={theme.subtle}> {String(toolCall.args.file_path)}</Text>
          <Text color={theme.userPrompt ?? theme.subtle}>{'╌'.repeat(Math.max(20, columns))}</Text>
          <DiffView diff={fileDiff} maxLines={maxDiffLines} width={Math.max(20, columns)} />
          <Text color={theme.userPrompt ?? theme.subtle}>{'╌'.repeat(Math.max(20, columns))}</Text>
        </Box>
      ) : (
        <>
          {gap}
          <Box flexDirection="column" marginLeft={2}>{renderDetails()}</Box>
          {gap}
        </>
      )}
      {danger ? <Text color={theme.warning}>⚠ {danger}</Text> : null}
      {note ? <Text color={theme.text}>{note}</Text> : null}
      <Text color={theme.text}>{toolCall.name === 'execute_bash' ? 'Do you want to proceed?' : fileDiff ? boldFile(title, String(toolCall.args.file_path ?? '')) : title}</Text>
      <Box flexDirection="column">
        {options.map((o, i) => {
          const selected = i === index;
          const comment = comments[i] ?? '';
          const amendThis = selected && amending;
          return (
            <Box key={i} flexDirection="row">
              <Text color={selected ? theme.permission : theme.subtle}>{selected ? '❯ ' : '  '}</Text>
              <Text color={theme.subtle}>{i + 1}. </Text>
              <Box flexShrink={1}>
                {amendThis ? (
                  <Text color={theme.permission}>
                    {o.label.split(',')[0]}, {comment ? <Text color={theme.text}>{comment}</Text> : <Text dimColor>{amendPlaceholder(toolCall.name, o)}</Text>}<Text inverse> </Text>
                  </Text>
                ) : (
                  <Text color={selected ? theme.permission : theme.text} wrap="wrap">
                    {renderLabel(o.label)}{comment ? <Text color={theme.subtle}> · {comment}</Text> : null}
                  </Text>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
      {!tiny ? gap : null}
      {!tiny ? <Text color={theme.subtle}>{footer}</Text> : null}
    </Box>
  );

  function renderDetails(): React.ReactNode {
    const { name, args } = toolCall;
    if (name === 'execute_bash') {
      return (
        <>
          <Text color={theme.text}>{String(args.command ?? '')}</Text>
          {!tiny && args.description ? <Text color={theme.subtle}>{String(args.description)}</Text> : null}
        </>
      );
    }
    if (name === 'exit_plan_mode') {
      const lines = String(args.plan ?? '').split('\n').length;
      return <Text color={theme.subtle}>Fuller's plan ({lines} lines) is shown above. Approving leaves plan mode.</Text>;
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
    if (name === 'web_fetch') return <Text color={theme.text}>{String(args.url ?? '')}</Text>;
    if (name === 'read_file' || name === 'outline_file') return <Text color={theme.text}>{String(args.file_path ?? '')}</Text>;
    if (name === 'list_directory') return <Text color={theme.text}>{String(args.dir_path ?? '.')}</Text>;
    if (name === 'search_files') return <Text color={theme.text}>{`"${String(args.query ?? '')}" in ${String(args.path ?? '.')}`}</Text>;
    if (name === 'glob') return <Text color={theme.text}>{`${String(args.pattern ?? '')} in ${String(args.path ?? '.')}`}</Text>;
    return <Text color={theme.subtle}>{JSON.stringify(args).slice(0, 400)}</Text>;
  }
};
