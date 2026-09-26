import React, { useMemo, useState } from 'react';
import os from 'node:os';
import path from 'node:path';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';
import { formatRelative, loadSession, type SessionMeta } from '../session/store.js';
import { messagesToTranscript } from '../agent/transcript.js';
import type { TranscriptItem } from '../agent/types.js';
import type { BannerProps } from './Banner.js';
import { useTranscriptRows } from './FullscreenTranscript.js';
import { OverlayFrame } from './OverlayFrame.js';

interface Props {
  sessions: SessionMeta[];
  /** Ctrl+A: every project's sessions. */
  allSessions?: () => SessionMeta[];
  /** The chosen session; its workspace may differ from the current one after Ctrl+A. */
  onSelect: (id: string, workspaceDir: string) => void;
  /** Ctrl+R: stores a new title. */
  onRename?: (session: SessionMeta, title: string) => void;
  /** Ctrl+Delete, after confirmation (Antigravity's /resume): deletes the session; false if it failed. */
  onDelete?: (session: SessionMeta) => boolean;
  /** Banner drawn at the top of the Space preview, as Claude Code does. */
  banner?: BannerProps;
  onCancel: () => void;
  /** Current git branch, for ctrl+b. */
  branch?: string;
  /** Text set into the top rule, e.g. the effort. */
  ruleLabel?: string;
}

/** "5 seconds ago", "3 minutes ago", "2 days ago": Claude Code's wording in /resume. */
export function timeAgo(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  const units: Array<[number, string]> = [[86_400 * 365, 'year'], [86_400 * 30, 'month'], [86_400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']];
  for (const [size, name] of units) {
    if (seconds >= size || size === 1) {
      const n = Math.floor(seconds / size);
      return `${n} ${name}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

const formatSize = (bytes?: number) => (bytes === undefined ? undefined
  : bytes >= 1024 * 1024 ? `${Number((bytes / 1024 / 1024).toFixed(1))}MB` : `${Number((bytes / 1024).toFixed(1))}KB`);

const tildify = (dir: string) => (dir.startsWith(os.homedir()) ? `~${dir.slice(os.homedir().length)}` : dir);

type Mode = 'list' | 'preview' | 'rename' | 'delete';

/**
 * Session picker laid out like Claude Code 2.1.281's /resume: a framed search
 * field, the project name, then each session on two lines (title, then
 * "age · branch · size"). Typing filters; Esc clears the filter, then cancels.
 * Ctrl+A lists every project, Space previews the conversation, Ctrl+R renames.
 */
export const SessionPicker: React.FC<Props> = ({ sessions, allSessions, onSelect, onRename, onDelete, banner, onCancel, branch, ruleLabel }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [branchOnly, setBranchOnly] = useState(false);
  const [everywhere, setEverywhere] = useState(false);
  const [mode, setMode] = useState<Mode>('list');
  const [draft, setDraft] = useState('');
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [previewTop, setPreviewTop] = useState<number | null>(null);
  const everyProject = useMemo(() => (everywhere && allSessions ? allSessions() : null), [everywhere, allSessions]);
  const source = (everyProject ?? sessions).filter((s) => !deleted.has(`${s.workspaceDir}/${s.id}`)).map((s) => (titles[s.id] ? { ...s, title: titles[s.id] } : s));
  const filtered = source
    .filter((s) => !branchOnly || !branch || s.gitBranch === branch)
    .filter((s) => !query || `${s.title ?? ''} ${s.id} ${s.gitBranch ?? ''} ${everywhere ? s.workspaceDir : ''}`.toLowerCase().includes(query.toLowerCase()));
  const safe = Math.max(0, Math.min(index, filtered.length - 1));
  const chosen = filtered[safe];
  const rows = stdout.rows || 24;
  const page = Math.max(1, Math.min(8, Math.floor((rows - 12) / 2)));
  // Ink's columns are one short of the terminal (LayoutMargin); Claude Code's field is terminal − 6 wide.
  const width = Math.max(20, (stdout.columns || 80) - 5);
  const project = sessions[0] ? path.basename(sessions[0].workspaceDir) : '';

  const previewItems = useMemo<TranscriptItem[]>(() => {
    if (mode !== 'preview' || !chosen) return [];
    const data = loadSession(chosen.workspaceDir, chosen.id);
    const messages = data ? messagesToTranscript(data.messages) : [];
    return banner ? [{ key: 'banner', kind: 'banner' } as TranscriptItem, ...messages] : messages;
  }, [mode, chosen?.id, chosen?.workspaceDir, banner]);
  const previewRows = useTranscriptRows({ items: previewItems, live: null, verbose: false, banner: banner ?? ({} as BannerProps), frame: '', permissionOpen: false, width: Math.max(20, (stdout.columns || 80) - 2) }).lines;
  const previewHeight = Math.max(3, rows - 9);
  const previewMaxTop = Math.max(0, previewRows.length - previewHeight);
  const top = Math.min(previewTop ?? previewMaxTop, previewMaxTop);

  useRawInput((e) => {
    if (mode === 'preview') {
      if (e.name === 'escape') setMode('list');
      else if (e.name === 'char' && e.ctrl && e.text === 'c') onCancel();
      else if (e.name === 'return' && chosen) onSelect(chosen.id, chosen.workspaceDir);
      else if (e.name === 'up') setPreviewTop(Math.max(0, top - 1));
      else if (e.name === 'down') setPreviewTop(Math.min(previewMaxTop, top + 1));
      else if (e.name === 'pageup') setPreviewTop(Math.max(0, top - previewHeight));
      else if (e.name === 'pagedown') setPreviewTop(Math.min(previewMaxTop, top + previewHeight));
      return;
    }
    if (mode === 'delete') {
      // Antigravity: Enter or Y deletes, Esc or N cancels.
      if (e.name === 'return' || (e.name === 'char' && !e.ctrl && /^[yY]$/.test(e.text))) {
        if (chosen && onDelete?.(chosen)) {
          setDeleted((d) => new Set(d).add(`${chosen.workspaceDir}/${chosen.id}`));
          setStatus(`Deleted "${chosen.title || chosen.id}"`);
          setIndex((i) => Math.max(0, Math.min(i, filtered.length - 2)));
        } else if (chosen) setStatus(`Could not delete "${chosen.title || chosen.id}"`);
        setMode('list');
      } else if (e.name === 'escape' || (e.name === 'char' && !e.ctrl && /^[nN]$/.test(e.text))) setMode('list');
      return;
    }
    if (mode === 'rename') {
      if (e.name === 'escape') setMode('list');
      else if (e.name === 'return') {
        const title = draft.trim();
        if (title && chosen) { onRename?.(chosen, title); setTitles((t) => ({ ...t, [chosen.id]: title })); }
        setMode('list');
      } else if (e.name === 'backspace') setDraft((d) => d.slice(0, -1));
      else if (e.name === 'char' && !e.ctrl && !e.alt) setDraft((d) => d + e.text);
      else if (e.name === 'paste') setDraft((d) => d + e.text.replace(/\s+/g, ' '));
      return;
    }
    if (e.name === 'escape') { if (query) { setQuery(''); setIndex(0); } else onCancel(); }
    else if (e.name === 'char' && e.ctrl && e.text === 'c') onCancel();
    else if (e.name === 'char' && e.ctrl && e.text === 'b') { setBranchOnly((value) => !value); setIndex(0); }
    else if (e.name === 'char' && e.ctrl && e.text === 'a' && allSessions) { setEverywhere((value) => !value); setIndex(0); }
    else if (e.name === 'char' && e.ctrl && e.text === 'r' && onRename && chosen) { setDraft(''); setMode('rename'); }
    else if (e.name === 'delete' && onDelete && chosen) { setStatus(null); setMode('delete'); }
    else if (e.name === 'char' && e.text === ' ' && !query && chosen) { setPreviewTop(null); setMode('preview'); }
    else if (e.name === 'up' || (e.name === 'char' && e.ctrl && e.text === 'p') || (e.name === 'mouse' && e.mouse?.button === 64)) setIndex((i) => Math.max(0, i - 1));
    else if (e.name === 'down' || (e.name === 'char' && e.ctrl && e.text === 'n') || (e.name === 'mouse' && e.mouse?.button === 65)) setIndex((i) => Math.min(Math.max(0, filtered.length - 1), i + 1));
    else if (e.name === 'pageup') setIndex((i) => Math.max(0, i - page));
    else if (e.name === 'pagedown') setIndex((i) => Math.min(Math.max(0, filtered.length - 1), i + page));
    else if (e.name === 'home') setIndex(0);
    else if (e.name === 'end') setIndex(Math.max(0, filtered.length - 1));
    else if (e.name === 'return') { if (chosen) onSelect(chosen.id, chosen.workspaceDir); }
    else if (e.name === 'backspace') setQuery((q) => q.slice(0, -1));
    else if (e.name === 'char' && !e.ctrl && !e.alt) { setQuery((q) => q + e.text); setIndex(0); }
  });

  if (mode === 'preview' && chosen) {
    // Claude Code replaces the list with the conversation, then "1h ago · 2 messages · HEAD".
    const details = [formatRelative(chosen.updatedAt), `${chosen.messageCount} message${chosen.messageCount === 1 ? '' : 's'}`, chosen.gitBranch].filter(Boolean).join(' · ');
    const columns = stdout.columns || 80;
    const label = ruleLabel ? ` ${ruleLabel} ` : '';
    return (
      <Box flexDirection="column" marginTop={1} width={columns}>
        <Text color={theme.permission}>{'▔'.repeat(Math.max(0, columns - label.length - (label ? 1 : 0)))}{label ? <><Text color={theme.subtle}>{label}</Text>▔</> : null}</Text>
        <Box flexDirection="column" paddingLeft={1}>
          {previewRows.slice(top, top + previewHeight).map((line, i) => <Text key={i}>{line || ' '}</Text>)}
        </Box>
        <Box flexDirection="column" paddingLeft={1}>
          <Text dimColor>{'─'.repeat(Math.max(1, columns - 3))}</Text>
          <Text>  {details}</Text>
          <Text color={theme.subtle}>  Enter to resume · Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  // Claude Code keeps the list anchored at the top and scrolls only past the page, with ↑/↓ on the edge rows.
  const offset = Math.max(0, Math.min(safe - page + 1, filtered.length - page));
  const visible = filtered.slice(offset, offset + page);
  const branchHint = branch ? `Ctrl+B to ${branchOnly ? 'show all branches' : 'only show current branch'} · ` : '';
  const hint = query
    ? 'Type to Search · Enter to select · Esc to clear'
    : `${allSessions ? `Ctrl+A to ${everywhere ? 'only show current repo' : 'show all projects'} · ` : ''}${branchHint}${chosen ? 'Space to preview · ' : ''}${onRename && chosen ? 'Ctrl+R to rename · ' : ''}${onDelete && chosen ? 'Ctrl+Del to delete · ' : ''}Type to search · Esc to cancel`;
  const header = (
    <Text bold wrap="truncate-end">
      <Text color={theme.permission}>Resume session</Text>
      {filtered.length > page ? <Text color={theme.subtle}> ({safe + 1} of {filtered.length})</Text> : null}
    </Text>
  );

  return (
    <OverlayFrame title="Resume session" header={header} ruleLabel={ruleLabel}>
      <Box borderStyle="round" borderColor={query ? theme.permission : undefined} borderDimColor={!query} width={width} paddingX={1}>
        {query ? <Text>⌕ {query}</Text> : <Text color={theme.subtle}>⌕ Search…</Text>}
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {project && !everywhere ? <Text color={theme.subtle}>{project}</Text> : null}
        {mode === 'delete' && chosen ? (
          <>
            <Text bold>Delete this conversation?</Text>
            <Text wrap="truncate-end">{chosen.title || chosen.id}</Text>
            <Text color={theme.subtle} wrap="truncate-end">{[timeAgo(chosen.updatedAt), chosen.gitBranch, formatSize(chosen.sizeBytes), everywhere ? tildify(chosen.workspaceDir) : undefined].filter(Boolean).join(' · ')}</Text>
            <Text color={theme.warning}>This cannot be undone.</Text>
            <Text color={theme.subtle}>Enter or Y to delete · Esc or N to cancel</Text>
          </>
        ) : mode === 'rename' ? (
          <>
            <Text bold>Rename session:</Text>
            <Text>{draft ? <>{draft}<Text inverse> </Text></> : <Text dimColor>Enter new session name</Text>}</Text>
            <Text color={theme.subtle}>Enter to save · Esc to cancel</Text>
          </>
        ) : (
          <>
            {filtered.length === 0 ? <Text color={theme.subtle}>{everywhere ? 'No conversations found.' : 'No conversations found in this project.'}</Text> : null}
            {visible.map((s, vi) => {
              const selected = offset + vi === safe && !query;
              const marker = selected ? '❯ ' : vi === 0 && offset > 0 ? '↑ ' : vi === visible.length - 1 && offset + page < filtered.length ? '↓ ' : '  ';
              const details = [timeAgo(s.updatedAt), s.gitBranch, formatSize(s.sizeBytes), everywhere ? tildify(s.workspaceDir) : undefined].filter(Boolean).join(' · ');
              return (
                <Box key={`${s.workspaceDir}/${s.id}`} flexDirection="column" marginLeft={-2}>
                  <Text wrap="truncate-end"><Text color={selected ? theme.permission : theme.subtle}>{marker}</Text><Text color={selected ? theme.permission : theme.text}>{s.title || s.id}</Text></Text>
                  <Text color={theme.subtle} wrap="truncate-end">  {details}</Text>
                </Box>
              );
            })}
            {status ? <Text color={theme.subtle}>{status}</Text> : null}
            <Text color={theme.subtle} wrap="wrap">{hint}</Text>
          </>
        )}
      </Box>
    </OverlayFrame>
  );
};
