import React, { useState } from 'react';
import path from 'node:path';
import { Box, Text, useStdout } from 'ink';
import stringWidth from 'string-width';
import { useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';
import { Banner } from './Banner.js';
import { modelLabel } from './modelLabel.js';
import { PLAY, PLAY_GAP, PAUSE, PAUSE_GAP } from './glyphs.js';
import type { AgentTask, PermissionMode } from '../agent/types.js';

interface Props {
  tasks: AgentTask[];
  model: string;
  workspaceDir: string;
  mode: PermissionMode;
  /** When the conversation last changed, for the "0s" on its row. */
  lastActivity: number;
  /** Spinner glyph for working agents. */
  frame: string;
  onClose: () => void;
  onStart: (task: string) => void;
  onDelete: (id: string) => void;
  /** Enter on an agent: show its report. */
  onOpen: (task: AgentTask) => void;
  /** ctrl+c: twice quits, as in Claude Code. */
  onCtrlC?: () => void;
  now?: number;
}

/** "0s", "12m", "3h", "2d": Claude Code's ages in the agents view. */
export function shortAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

const NAME_WIDTH = 25;

const MODE_LABEL: Record<PermissionMode, string> = {
  default: `${PAUSE}${PAUSE_GAP}manual mode`,
  acceptEdits: `${PLAY}${PLAY_GAP}accept edits`,
  plan: `${PAUSE}${PAUSE_GAP}plan mode`,
  auto: `${PLAY}${PLAY_GAP}auto mode`,
  bypassPermissions: `${PLAY}${PLAY_GAP}bypass permissions`,
};

/**
 * ← on an empty prompt, as in Claude Code 2.1.281: the conversation moves to
 * the background and a board lists it ("Needs input") with the background
 * agents (Working, Completed). A task typed at the bottom starts a new agent.
 * Fuller's agents are the /btw forks and the tasks started here.
 */
export const AgentsView: React.FC<Props> = ({ tasks, model, workspaceDir, mode, lastActivity, frame, onClose, onStart, onDelete, onOpen, onCtrlC, now = Date.now() }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = Math.max(40, (stdout.columns || 80));
  const [draft, setDraft] = useState('');
  const [index, setIndex] = useState(0);
  const working = tasks.filter((t) => t.status === 'working');
  const done = tasks.filter((t) => t.status !== 'working').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  // Row 0 is the conversation, then the agents in display order.
  const rows: Array<AgentTask | null> = [null, ...working, ...done];
  const safe = Math.min(index, rows.length - 1);

  useRawInput((e) => {
    if (e.name === 'char' && e.ctrl && e.text === 'c') { if (draft) setDraft(''); else onCtrlC?.(); return; }
    if (draft) {
      if (e.name === 'escape') setDraft('');
      else if (e.name === 'return') { onStart(draft.trim()); setDraft(''); }
      else if (e.name === 'backspace') setDraft((d) => d.slice(0, -1));
      else if (e.name === 'char' && !e.ctrl && !e.alt) setDraft((d) => d + e.text);
      else if (e.name === 'paste') setDraft((d) => d + e.text.replace(/\s+/g, ' '));
      return;
    }
    if (e.name === 'escape' || e.name === 'right') onClose();
    else if (e.name === 'up') setIndex(Math.max(0, safe - 1));
    else if (e.name === 'down') setIndex(Math.min(rows.length - 1, safe + 1));
    else if (e.name === 'return') { const row = rows[safe]; if (row) onOpen(row); else onClose(); }
    else if (e.name === 'char' && e.ctrl && e.text === 'x') { const row = rows[safe]; if (row) { onDelete(row.id); setIndex(Math.max(0, safe - 1)); } }
    else if (e.name === 'char' && !e.ctrl && !e.alt && e.text.trim()) setDraft(e.text);
    else if (e.name === 'paste') setDraft(e.text.replace(/\s+/g, ' '));
  });

  const line = (key: string, glyph: React.ReactNode, name: string, detail: string, age: string, selected: boolean, dim: boolean) => {
    const head = `${name.length > NAME_WIDTH - 1 ? `${name.slice(0, NAME_WIDTH - 2)}…` : name}`.padEnd(NAME_WIDTH);
    const room = Math.max(0, width - 2 - NAME_WIDTH - age.length - 2);
    const shownDetail = stringWidth(detail) > room ? `${detail.slice(0, Math.max(0, room - 1))}…` : detail;
    const gap = Math.max(1, width - 2 - NAME_WIDTH - stringWidth(shownDetail) - age.length);
    const bg = selected ? theme.userBg : undefined;
    return (
      <Text key={key} backgroundColor={bg} wrap="truncate-end">
        {glyph}
        <Text bold={selected} color={dim && !selected ? theme.subtle : theme.user}>{head}</Text>
        <Text color={theme.subtle}>{shownDetail}{' '.repeat(gap)}{age}</Text>
      </Text>
    );
  };
  const counts = `${1} awaiting input · ${working.length} working · ${done.length} completed`;

  return (
    <Box flexDirection="column" width={width}>
      <Banner model={model} workspaceDir={workspaceDir} lines={[`${modelLabel(model)} · ${workspaceDir}`, counts]} />
      <Text color={theme.subtle}>Your conversation moved to the background — enter opens it · esc returns to it · ctrl+c twice quits</Text>
      <Text bold color={theme.subtle}>Needs input</Text>
      {line('current', <Text color={theme.warning} backgroundColor={safe === 0 ? theme.userBg : undefined}>✻ </Text>, 'current session', path.basename(workspaceDir), shortAge(now - lastActivity), safe === 0, false)}
      {working.length ? <Text color={theme.subtle}>Working</Text> : null}
      {working.map((task, i) => line(task.id, <Text color={theme.accent} backgroundColor={safe === 1 + i ? theme.userBg : undefined}>{frame} </Text>, task.title, task.progress ?? '', shortAge(now - task.startedAt), safe === 1 + i, false))}
      {done.length ? <Text color={theme.subtle}>Completed</Text> : null}
      {done.map((task, i) => {
        const row = 1 + working.length + i;
        const summary = (task.report ?? '').split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
        return line(task.id, <Text color={task.status === 'failed' ? theme.error : theme.success} backgroundColor={safe === row ? theme.userBg : undefined}>∙ </Text>, task.title, summary, shortAge(now - (task.endedAt ?? now)), safe === row, true);
      })}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>{'─'.repeat(width)}</Text>
        <Text>{draft ? <Text>❯ {draft}<Text inverse> </Text></Text> : <Text color={theme.subtle}>❯ describe a task for a new session</Text>}</Text>
        <Text dimColor>{'─'.repeat(width)}</Text>
      </Box>
      <Text wrap="truncate-end">
        {'  '}<Text color={mode === 'default' ? theme.subtle : mode === 'plan' ? theme.planMode : mode === 'acceptEdits' ? theme.autoAccept : mode === 'auto' ? theme.warning : theme.bypass}>{MODE_LABEL[mode]}</Text>
        <Text color={theme.subtle}>{draft ? ' · enter to start · esc to clear' : ` · enter to ${safe === 0 ? 'return' : 'open'} · ctrl+x to delete · esc to return`}</Text>
      </Text>
    </Box>
  );
};
