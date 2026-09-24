import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from './theme.js';
import { effectiveThinkingLevel, type ThinkingLevelSetting } from '../agent/thinking.js';
import type { AgentStatus, PermissionMode, UsageInfo } from '../agent/types.js';
import { PLAY, PLAY_GAP, PAUSE, PAUSE_GAP } from './glyphs.js';
import { quotaBar, formatDuration } from '../agent/quotaText.js';
import type { ModelUsage } from '../agent/keyPool.js';

interface Props {
  mode: PermissionMode;
  status: AgentStatus;
  usage: UsageInfo;
  autoCompactThreshold: number;
  inputEmpty: boolean;
  bashMode: boolean;
  menuOpen?: boolean;
  /** Transient input hint shown in place of the mode, e.g. "Press Ctrl-C again to exit". */
  hint?: string;
  /** Output of the custom status line command, when configured. */
  statusLine?: string | null;
  statusLinePadding?: number;
  backgroundTasks?: number;
  /** Quota of the model in use over every key; shown once a key is spent. */
  quota?: ModelUsage | null;
}

/** Effort glyphs as Claude Code 2.1.281 shows them; minimal (Gemini only) gets a dotted circle. */
export const EFFORT_GLYPHS: Record<string, string> = { minimal: '◌', low: '○', medium: '◐', high: '●', xhigh: '◉', max: '◈' };

/**
 * Right-aligned line above the prompt, as in Claude Code: the effort at rest,
 * replaced by a hint about the input when there is one.
 */
export const PromptHints: React.FC<{ model: string; thinkingLevel?: ThinkingLevelSetting; multiline?: boolean; killed?: boolean; stashed?: boolean; editor?: string }> = ({ model, thinkingLevel, multiline, killed, stashed, editor }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const effort = effectiveThinkingLevel(model, thinkingLevel);
  const text = killed ? 'Ctrl+Y to paste deleted text'
    : multiline && editor ? `ctrl+g to edit in ${editor}`
    : effort ? `${EFFORT_GLYPHS[effort] ?? '◐'} ${effort} · /effort` : '';
  // Claude Code appends "· › stashed" while a prompt is put aside with ctrl+s.
  const shown = stashed ? (text ? `${text} · › stashed` : '› stashed') : text;
  return (
    <Box width={Math.max(1, stdout.columns || 80)} justifyContent="flex-end" paddingRight={1}>
      <Text color={theme.subtle} wrap="truncate-start">{shown || ' '}</Text>
    </Box>
  );
};

/** Percent of context left before auto-compact from which the footer shows it. */
export const CONTEXT_WARNING_LEFT = 20;
/** From this share of the model's quota spent (over every key), the footer turns to the warning colour. */
const QUOTA_WARNING = 0.8;

export const Footer: React.FC<Props> = ({ mode, status, usage, autoCompactThreshold, inputEmpty, bashMode, menuOpen = false, hint, statusLine, statusLinePadding, backgroundTasks = 0, quota }) => {
  const theme = useTheme();
  const busy = status !== 'idle';

  // Claude Code: the mode on the left in its colour, then hints in grey while
  // the input is empty; only the mode while typing; transient hints replace it.
  const hints = busy
    ? ' · esc to interrupt · ← for agents'
    : inputEmpty ? (mode === 'default' ? ' · ? for shortcuts · ← for agents' : ' (shift+tab to cycle) · ← for agents') : '';
  let modeNode: React.ReactNode;
  if (hint) modeNode = <Text color={theme.subtle}>{hint}</Text>;
  else if (bashMode) modeNode = <Text color={theme.bashBorder}>! for shell mode</Text>;
  else if (mode === 'acceptEdits') modeNode = <Text color={theme.autoAccept}>{PLAY}{PLAY_GAP}accept edits on<Text color={theme.subtle}>{hints}</Text></Text>;
  else if (mode === 'plan') modeNode = <Text color={theme.planMode}>{PAUSE}{PAUSE_GAP}plan mode on<Text color={theme.subtle}>{hints}</Text></Text>;
  else if (mode === 'auto') modeNode = <Text color={theme.warning}>{PLAY}{PLAY_GAP}auto mode on<Text color={theme.subtle}>{hints}</Text></Text>;
  else if (mode === 'bypassPermissions') modeNode = <Text color={theme.bypass}>{PLAY}{PLAY_GAP}bypass permissions on<Text color={theme.subtle}>{hints}</Text></Text>;
  else modeNode = <Text color={theme.subtle}>{PAUSE}{PAUSE_GAP}manual mode on{hints}</Text>;

  const used = usage.promptTokens / usage.contextWindow;
  const left = Math.max(0, Math.round((autoCompactThreshold - used) / autoCompactThreshold * 100));
  // Claude Code warns from 80 % of the context used, i.e. 20 % left before auto-compact.
  const showContext = usage.promptTokens > 0 && left <= CONTEXT_WARNING_LEFT;

  const showQuota = !!quota && quota.exhausted > 0 && !hint;

  if (statusLine !== undefined && statusLine !== null) {
    const lines = statusLine.split('\n').slice(0, 3);
    return (
      <Box flexDirection="column" paddingX={statusLinePadding ?? 1}>
        {mode !== 'default' || bashMode || busy || menuOpen ? <Box>{modeNode}</Box> : null}
        {lines.map((l, i) => <Text key={i}>{l || ' '}</Text>)}
      </Box>
    );
  }

  return (
    <Box justifyContent="space-between" paddingLeft={2} paddingRight={1}>
      <Box flexShrink={1}><Text wrap="truncate-end">{modeNode}</Text></Box>
      <Box flexShrink={0}>
        {backgroundTasks > 0 ? <Text color={theme.accent}>⏵ {backgroundTasks} background task{backgroundTasks > 1 ? 's' : ''} (/tasks){showContext ? ' · ' : ''}</Text> : null}
        {showContext ? (
          <Text color={left < 20 ? theme.warning : theme.subtle}>Context left until auto-compact: {left}%</Text>
        ) : null}
        {showQuota && quota ? (
          // One bar for the model over every key (Gemini CLI shows usage from its warning threshold).
          <Text color={quota.usedFraction >= QUOTA_WARNING ? theme.warning : theme.subtle}>{showContext || backgroundTasks > 0 ? ' · ' : ''}quota {quotaBar(quota.usedFraction, 10)} {Math.round(quota.usedFraction * 100)}%{quota.resetsAt ? ` · resets in ${formatDuration(quota.resetsAt - Date.now())}` : ''}</Text>
        ) : null}
      </Box>
    </Box>
  );
};
