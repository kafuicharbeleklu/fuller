import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import stringWidth from 'string-width';
import { useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';
import { DiffRow, diffRows, diffStats } from './DiffView.js';
import type { FileDiff } from './gitDiff.js';
import type { ChatMessage } from '../agent/types.js';

/** One view of the classic diff viewer: "Current" (git), or the edits of one turn (from the tool calls). */
export interface DiffTurnView {
  label: string;
  files: FileDiff[];
}

export interface DiffViewerData {
  /** Uncommitted changes from git, or, when there are none, what the branch adds on top of the default branch. */
  current: FileDiff[];
  /** Where `current` comes from, for the status line. */
  currentBase: 'uncommitted' | 'branch' | 'none';
  branch?: string | null;
  turns: DiffTurnView[];
}

/**
 * A turn view for each prompt after which the agent edited files, built from the tool calls
 * (edit_file, write_file) rather than from git, as Claude Code documents it: a change made
 * through a shell command appears only under Current.
 */
export function turnViews(messages: ChatMessage[]): DiffTurnView[] {
  const views: DiffTurnView[] = [];
  let turn = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'user' || m.kind === 'command') continue;
    turn++;
    const byFile = new Map<string, string[]>();
    for (let j = i + 1; j < messages.length && messages[j].role !== 'user'; j++) {
      for (const part of messages[j].parts ?? []) {
        if (part.type !== 'tool') continue;
        const call = part.toolCall;
        if ((call.name !== 'edit_file' && call.name !== 'write_file') || call.status !== 'completed' || !call.diff) continue;
        const file = String(call.args.file_path ?? '');
        byFile.set(file, [...(byFile.get(file) ?? []), call.diff]);
      }
    }
    if (!byFile.size) continue;
    const prompt = (m.content || '').split('\n')[0].trim();
    const label = `Turn ${turn}${prompt ? `: ${prompt.length > 32 ? `${prompt.slice(0, 31)}…` : prompt}` : ''}`;
    const files = [...byFile.entries()].map(([file, diffs]) => {
      const diff = diffs.join('\n');
      return { file, diff, ...diffStats(diff) };
    });
    views.push({ label, files });
  }
  return views;
}

interface Props {
  data: DiffViewerData;
  onClose: () => void;
  onRefresh?: () => void;
}

/**
 * The classic renderer's /diff: it takes the place of the prompt. Left and Right move between
 * Current and the turn views, Up and Down select a file, Enter opens its diff (Up/Down and
 * PageUp/PageDown scroll it), Esc returns to the list or closes the viewer (Claude Code docs).
 */
export const DiffViewer: React.FC<Props> = ({ data, onClose, onRefresh }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const columns = Math.max(20, stdout.columns || 80);
  const page = Math.max(3, (stdout.rows || 24) - 4);
  const views = useMemo<DiffTurnView[]>(() => [{ label: 'Current', files: data.current }, ...data.turns], [data]);
  const [view, setView] = useState(0);
  const [selected, setSelected] = useState(0);
  const [opened, setOpened] = useState(false);
  const [top, setTop] = useState(0);
  const files = views[Math.min(view, views.length - 1)]?.files ?? [];
  const file = files[Math.min(selected, Math.max(0, files.length - 1))];
  useEffect(() => { setSelected(0); setOpened(false); setTop(0); }, [view]);
  const body = useMemo(() => (opened && file ? diffRows(file.diff) : null), [opened, file]);
  const maxTop = Math.max(0, (body?.rows.length ?? 0) - page);

  useRawInput((e) => {
    if (e.name === 'char' && e.ctrl && (e.text === 'c' || e.text === 'o')) { onClose(); return; }
    if (opened) {
      if (e.name === 'escape' || (e.name === 'char' && e.text === 'q')) { setOpened(false); setTop(0); return; }
      if (e.name === 'up' || (e.name === 'char' && e.text === 'k')) setTop((t) => Math.max(0, t - 1));
      else if (e.name === 'down' || (e.name === 'char' && e.text === 'j')) setTop((t) => Math.min(maxTop, t + 1));
      else if (e.name === 'pageup') setTop((t) => Math.max(0, t - page));
      else if (e.name === 'pagedown' || (e.name === 'char' && e.text === ' ')) setTop((t) => Math.min(maxTop, t + page));
      else if (e.name === 'home') setTop(0);
      else if (e.name === 'end') setTop(maxTop);
      else if (e.name === 'mouse' && e.mouse?.button === 64) setTop((t) => Math.max(0, t - 3));
      else if (e.name === 'mouse' && e.mouse?.button === 65) setTop((t) => Math.min(maxTop, t + 3));
      return;
    }
    if (e.name === 'escape' || (e.name === 'char' && e.text === 'q')) { onClose(); return; }
    if (e.name === 'left') setView((v) => (v - 1 + views.length) % views.length);
    else if (e.name === 'right') setView((v) => (v + 1) % views.length);
    else if (e.name === 'up' || (e.name === 'char' && e.text === 'k')) setSelected((s) => Math.max(0, s - 1));
    else if (e.name === 'down' || (e.name === 'char' && e.text === 'j')) setSelected((s) => Math.min(Math.max(0, files.length - 1), s + 1));
    else if (e.name === 'return' && file) { setOpened(true); setTop(0); }
    else if (e.name === 'char' && e.text === 'r') onRefresh?.();
  });

  const tabs = views.map((v, i) => (
    <Text key={i} color={i === view ? theme.accent : theme.subtle} bold={i === view}>{i > 0 ? '  ' : ''}{v.label}</Text>
  ));
  const source = view === 0
    ? data.currentBase === 'branch' ? `what this branch adds on top of ${data.branch ?? 'the default branch'}` : data.currentBase === 'uncommitted' ? 'uncommitted changes' : 'no changes'
    : 'edits made in this turn';
  const stat = (f: FileDiff) => <><Text color="#38a660">+{f.additions}</Text><Text> </Text><Text color="#b3596b">-{f.removals}</Text></>;

  if (opened && file && body) {
    const width = Math.max(10, columns - 2);
    return (
      <Box flexDirection="column">
        <Box><Text bold>{file.file}</Text><Text> </Text>{stat(file)}<Text color={theme.subtle}>{body.hidden ? ` · ${body.hidden} more lines not shown` : ''}</Text></Box>
        <Box flexDirection="column" height={page}>
          {body.rows.slice(top, top + page).map((line, i) => <DiffRow key={`${top}-${i}`} line={line} numberWidth={body.numberWidth} width={width} />)}
        </Box>
        <Text color={theme.subtle}>{'─'.repeat(Math.max(1, columns - 1))}</Text>
        <Text color={theme.subtle}>↑/↓ · PgUp/PgDn to scroll · Esc to return to the list{maxTop ? ` · ${top + 1}-${Math.min(top + page, body.rows.length)} of ${body.rows.length}` : ''}</Text>
      </Box>
    );
  }

  const rows: React.ReactNode[] = [];
  if (!files.length) rows.push(<Text key="none" color={theme.subtle}>  {view === 0 ? 'No changes' : 'No edits in this turn'}</Text>);
  const from = Math.max(0, Math.min(selected - Math.floor((page - 1) / 2), files.length - (page - 1)));
  files.slice(from, from + page - 1).forEach((f, i) => {
    const index = from + i;
    const name = stringWidth(f.file) > columns - 16 ? `…${f.file.slice(-(columns - 17))}` : f.file;
    rows.push(<Box key={f.file}><Text color={index === selected ? theme.accent : undefined}>{index === selected ? '❯ ' : '  '}{name}</Text><Text> </Text>{stat(f)}</Box>);
  });
  return (
    <Box flexDirection="column">
      <Box>{tabs}<Text color={theme.subtle}>{views.length > 1 ? '  ←/→' : ''}</Text></Box>
      <Box flexDirection="column" height={page - 1}>{rows}</Box>
      <Text color={theme.subtle}>{'─'.repeat(Math.max(1, columns - 1))}</Text>
      <Text color={theme.subtle}>{source} · ↑/↓ to select · Enter to open · Esc to close{onRefresh ? ' · r to refresh' : ''}</Text>
    </Box>
  );
};
