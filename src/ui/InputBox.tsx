import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { useRawInput, type KeyEvent } from './useRawInput.js';
import { getFileIndex, fuzzyFilter } from '../utils/fileIndex.js';
import type { SlashCommand } from './commands.js';

export interface InputBoxProps {
  isActive: boolean;
  busy: boolean;
  queue: string[];
  history: string[];
  cwd: string;
  commands: SlashCommand[];
  showHelp: boolean;
  onSubmit: (text: string) => void;
  onCommand: (command: string) => void;
  onBash: (command: string) => void;
  onInterrupt: () => void;
  onExit: () => void;
  onCycleMode: () => void;
  onClearScreen: () => void;
  onToggleVerbose: () => void;
  onToggleHelp: () => void;
  onToggleTodos?: () => void;
  onDoubleEscape: () => void;
  onPopQueue: () => string | undefined;
  onStateChange?: (state: { empty: boolean; bashMode: boolean }) => void;
}

interface EditorState {
  text: string;
  cursor: number;
}

const PASTE_RE = /\[Pasted text #(\d+) \+(\d+) lines\]/g;
const PASTE_TAIL_RE = /\[Pasted text #(\d+) \+(\d+) lines\]$/;

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_\-./]/u.test(ch);
}

export const InputBox: React.FC<InputBoxProps> = (props) => {
  const theme = useTheme();
  const {
    isActive, busy, queue, history: initialHistory, cwd, commands, showHelp,
    onSubmit, onCommand, onBash, onInterrupt, onExit, onCycleMode, onClearScreen,
    onToggleVerbose, onToggleHelp, onToggleTodos, onDoubleEscape, onPopQueue, onStateChange,
  } = props;

  const ed = useRef<EditorState>({ text: '', cursor: 0 });
  const undo = useRef<EditorState[]>([]);
  const lastTypeAt = useRef(0);
  const killRing = useRef('');
  const pastes = useRef(new Map<number, string>());
  const pasteCounter = useRef(0);
  const history = useRef<string[]>(initialHistory);
  const historyIndex = useRef(-1);
  const draft = useRef('');
  const lastCtrlC = useRef(0);
  const lastEsc = useRef(0);
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const [bashMode, setBashMode] = useState(false);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [search, setSearch] = useState<{ query: string; index: number } | null>(null);
  const [fileIndex, setFileIndex] = useState<string[]>([]);
  const [ctrlCHint, setCtrlCHint] = useState(false);

  const { text, cursor } = ed.current;
  const empty = text.length === 0;

  useEffect(() => {
    onStateChange?.({ empty, bashMode });
  }, [empty, bashMode, onStateChange]);

  // ------------------------------------------------------------ menus
  const slashActive = !bashMode && !search && !menuDismissed && text.startsWith('/') && !/\s/.test(text);
  const slashMatches = slashActive
    ? commands.filter((c) => c.name.startsWith(text) || (text.length > 1 && c.name.includes(text.slice(1))))
    : [];

  const atToken = (() => {
    if (bashMode || search || menuDismissed) return null;
    const before = text.slice(0, cursor);
    const m = before.match(/(?:^|\s)(@[^\s@]*)$/);
    return m ? m[1] : null;
  })();
  const atMatches = atToken !== null ? fuzzyFilter(fileIndex, atToken.slice(1), 8) : [];

  useEffect(() => {
    if (atToken === null) return;
    let cancelled = false;
    getFileIndex(cwd).then((files) => { if (!cancelled) setFileIndex(files); }).catch(() => {});
    return () => { cancelled = true; };
  }, [atToken !== null, cwd]);

  const menuOpen = slashMatches.length > 0 || atMatches.length > 0;
  const menuLength = slashMatches.length || atMatches.length;
  const safeMenuIndex = Math.min(menuIndex, Math.max(0, menuLength - 1));

  // ------------------------------------------------------------ editor helpers
  const snapshot = (typing = false) => {
    const now = Date.now();
    if (typing && now - lastTypeAt.current < 600 && undo.current.length) { lastTypeAt.current = now; return; }
    lastTypeAt.current = typing ? now : 0;
    undo.current.push({ ...ed.current });
    if (undo.current.length > 100) undo.current.shift();
  };
  const set = (t: string, c = t.length) => {
    ed.current = { text: t, cursor: Math.max(0, Math.min(c, t.length)) };
    setMenuDismissed(false);
    setMenuIndex(0);
    bump();
  };
  const insert = (s: string, typing = false) => {
    snapshot(typing);
    const { text: t, cursor: c } = ed.current;
    set(t.slice(0, c) + s + t.slice(c), c + s.length);
    historyIndex.current = -1;
  };
  const prevCp = (t: string, c: number) => { if (c <= 0) return 0; const cp = t.codePointAt(c - 1); const low = t.charCodeAt(c - 1); return low >= 0xdc00 && low <= 0xdfff && c >= 2 ? c - 2 : cp !== undefined ? c - 1 : c - 1; };
  const nextCp = (t: string, c: number) => { if (c >= t.length) return t.length; const cp = t.codePointAt(c)!; return c + (cp > 0xffff ? 2 : 1); };
  const backspace = () => {
    const { text: t, cursor: c } = ed.current;
    if (c === 0) return;
    snapshot();
    const head = t.slice(0, c);
    const m = head.match(PASTE_TAIL_RE);
    if (m) { pastes.current.delete(Number(m[1])); set(head.slice(0, -m[0].length) + t.slice(c), c - m[0].length); return; }
    const p = prevCp(t, c);
    set(t.slice(0, p) + t.slice(c), p);
  };
  const del = () => {
    const { text: t, cursor: c } = ed.current;
    if (c >= t.length) return;
    snapshot();
    set(t.slice(0, c) + t.slice(nextCp(t, c)), c);
  };
  const moveWordLeft = () => {
    const { text: t, cursor: c } = ed.current;
    let p = c;
    while (p > 0 && !isWordChar(t[p - 1])) p--;
    while (p > 0 && isWordChar(t[p - 1])) p--;
    return p;
  };
  const moveWordRight = () => {
    const { text: t, cursor: c } = ed.current;
    let p = c;
    while (p < t.length && !isWordChar(t[p])) p++;
    while (p < t.length && isWordChar(t[p])) p++;
    return p;
  };
  const deleteWordBack = () => {
    const { text: t, cursor: c } = ed.current;
    const p = moveWordLeft();
    if (p === c) return;
    snapshot();
    killRing.current = t.slice(p, c);
    set(t.slice(0, p) + t.slice(c), p);
  };
  const lineBounds = (t: string, c: number) => {
    const start = t.lastIndexOf('\n', c - 1) + 1;
    let end = t.indexOf('\n', c);
    if (end === -1) end = t.length;
    return { start, end };
  };
  const killToEnd = () => {
    const { text: t, cursor: c } = ed.current;
    const { end } = lineBounds(t, c);
    if (end === c) { if (c < t.length) { snapshot(); killRing.current = '\n'; set(t.slice(0, c) + t.slice(c + 1), c); } return; }
    snapshot();
    killRing.current = t.slice(c, end);
    set(t.slice(0, c) + t.slice(end), c);
  };
  const killToStart = () => {
    const { text: t, cursor: c } = ed.current;
    const { start } = lineBounds(t, c);
    if (start === c) return;
    snapshot();
    killRing.current = t.slice(start, c);
    set(t.slice(0, start) + t.slice(c), start);
  };
  const yank = () => { if (killRing.current) insert(killRing.current); };
  const undoOnce = () => {
    const prev = undo.current.pop();
    if (prev) { ed.current = prev; bump(); }
  };
  const moveLine = (dir: -1 | 1): boolean => {
    const { text: t, cursor: c } = ed.current;
    const { start, end } = lineBounds(t, c);
    const col = c - start;
    if (dir === -1) {
      if (start === 0) return false;
      const { start: ps } = lineBounds(t, start - 1);
      ed.current.cursor = Math.min(ps + col, start - 1);
    } else {
      if (end >= t.length) return false;
      const { start: ns, end: ne } = lineBounds(t, end + 1);
      ed.current.cursor = Math.min(ns + col, ne);
    }
    bump();
    return true;
  };

  const expandPastes = (t: string) => t.replace(PASTE_RE, (m, n) => pastes.current.get(Number(n)) ?? m);

  const insertPaste = (raw: string) => {
    const normalized = raw.replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n').length;
    if (lines > 3 || normalized.length > 800) {
      const n = ++pasteCounter.current;
      pastes.current.set(n, normalized);
      insert(`[Pasted text #${n} +${lines} lines]`);
    } else {
      insert(normalized);
    }
  };

  const resetEditor = () => {
    ed.current = { text: '', cursor: 0 };
    undo.current = [];
    pastes.current.clear();
    historyIndex.current = -1;
    draft.current = '';
    setMenuDismissed(false);
    setMenuIndex(0);
    setSearch(null);
    bump();
  };

  const pushHistory = (t: string) => {
    if (history.current[history.current.length - 1] !== t) history.current.push(t);
  };

  const submit = () => {
    const raw = ed.current.text;
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (bashMode) {
      pushHistory('!' + trimmed);
      resetEditor();
      setBashMode(false);
      onBash(trimmed);
      return;
    }
    const expanded = expandPastes(raw).trim();
    pushHistory(trimmed);
    resetEditor();
    if (expanded.startsWith('/') && !expanded.includes('\n')) onCommand(expanded);
    else onSubmit(expanded);
  };

  const browseHistory = (dir: -1 | 1) => {
    const h = history.current;
    if (h.length === 0) return;
    if (historyIndex.current === -1) {
      if (dir === 1) return;
      draft.current = ed.current.text;
      historyIndex.current = h.length - 1;
    } else {
      const next = historyIndex.current + dir;
      if (next >= h.length) { historyIndex.current = -1; set(draft.current); return; }
      if (next < 0) return;
      historyIndex.current = next;
    }
    const entry = h[historyIndex.current];
    if (entry.startsWith('!') && !bashMode) { setBashMode(true); set(entry.slice(1)); }
    else set(entry);
    setMenuDismissed(true);
  };

  const completeMenu = (execute: boolean) => {
    if (slashMatches.length > 0) {
      const cmd = slashMatches[safeMenuIndex];
      if (!cmd) return;
      if (execute && (!cmd.takesArg || ed.current.text.trim() === cmd.name)) {
        pushHistory(cmd.name);
        resetEditor();
        onCommand(cmd.name);
        return;
      }
      set(cmd.name + ' ');
      setMenuDismissed(true);
      return;
    }
    if (atMatches.length > 0 && atToken !== null) {
      const file = atMatches[safeMenuIndex];
      const { text: t, cursor: c } = ed.current;
      const start = c - atToken.length;
      snapshot();
      set(t.slice(0, start) + '@' + file + ' ' + t.slice(c), start + file.length + 2);
    }
  };

  const searchMatches = (query: string): number[] => {
    const q = query.toLowerCase();
    const out: number[] = [];
    for (let i = history.current.length - 1; i >= 0; i--) if (!q || history.current[i].toLowerCase().includes(q)) out.push(i);
    return out;
  };

  // ------------------------------------------------------------ key handling
  const handle = (e: KeyEvent) => {
    if (e.name === 'paste') { insertPaste(e.text); return; }

    if (search) {
      if (e.name === 'escape' || e.name === 'tab') { setSearch(null); return; }
      if (e.name === 'return') { setSearch(null); submit(); return; }
      if (e.name === 'char' && e.ctrl && e.text === 'r') {
        const m = searchMatches(search.query);
        const nextIdx = m.length ? (search.index + 1) % m.length : 0;
        setSearch({ query: search.query, index: nextIdx });
        if (m.length) set(history.current[m[nextIdx]]);
        return;
      }
      if (e.name === 'char' && e.ctrl && (e.text === 'c' || e.text === 'g')) { setSearch(null); set(draft.current); return; }
      if (e.name === 'backspace') {
        const q = search.query.slice(0, -1);
        const m = searchMatches(q);
        setSearch({ query: q, index: 0 });
        if (m.length) set(history.current[m[0]]);
        return;
      }
      if (e.name === 'char' && !e.ctrl && !e.alt) {
        const q = search.query + e.text;
        const m = searchMatches(q);
        setSearch({ query: q, index: 0 });
        if (m.length) set(history.current[m[0]]);
        return;
      }
      return;
    }

    if (e.name === 'char' && e.ctrl) {
      switch (e.text) {
        case 'c':
          if (busy) { onInterrupt(); return; }
          if (ed.current.text) { resetEditor(); setCtrlCHint(false); return; }
          if (bashMode) { setBashMode(false); return; }
          if (Date.now() - lastCtrlC.current < 1500) { onExit(); return; }
          lastCtrlC.current = Date.now();
          setCtrlCHint(true);
          setTimeout(() => setCtrlCHint(false), 1500);
          return;
        case 'd':
          if (!ed.current.text && !busy) { onExit(); return; }
          del();
          return;
        case 'o': onToggleVerbose(); return;
        case 't': onToggleTodos?.(); return;
        case 'l': onClearScreen(); return;
        case 'r':
          if (history.current.length) { draft.current = ed.current.text; setSearch({ query: '', index: 0 }); }
          return;
        case '_': case 'z': undoOnce(); return;
        case 'a': ed.current.cursor = lineBounds(ed.current.text, ed.current.cursor).start; bump(); return;
        case 'e': ed.current.cursor = lineBounds(ed.current.text, ed.current.cursor).end; bump(); return;
        case 'b': ed.current.cursor = prevCp(ed.current.text, ed.current.cursor); bump(); return;
        case 'f': ed.current.cursor = nextCp(ed.current.text, ed.current.cursor); bump(); return;
        case 'k': killToEnd(); return;
        case 'u': killToStart(); return;
        case 'w': case 'h': if (e.text === 'h') backspace(); else deleteWordBack(); return;
        case 'y': yank(); return;
        case 'j': insert('\n'); return;
        default: return;
      }
    }

    switch (e.name) {
      case 'escape': {
        if (menuOpen) { setMenuDismissed(true); return; }
        if (busy) { onInterrupt(); lastEsc.current = 0; return; }
        if (bashMode && !ed.current.text) { setBashMode(false); return; }
        const now = Date.now();
        if (now - lastEsc.current < 600) { lastEsc.current = 0; if (ed.current.text) resetEditor(); else onDoubleEscape(); return; }
        lastEsc.current = now;
        return;
      }
      case 'tab':
        if (e.shift) { onCycleMode(); return; }
        if (menuOpen) completeMenu(false);
        return;
      case 'return': {
        if (e.alt || e.ctrl || e.shift) { insert('\n'); return; }
        const { text: t, cursor: c } = ed.current;
        const { end } = lineBounds(t, c);
        if (end === c && t.slice(0, c).endsWith('\\')) { snapshot(); set(t.slice(0, c - 1) + '\n' + t.slice(c), c); return; }
        if (menuOpen) { completeMenu(true); return; }
        submit();
        return;
      }
      case 'up':
        if (menuOpen) { setMenuIndex((i) => (i <= 0 ? menuLength - 1 : i - 1)); return; }
        if (!ed.current.text && queue.length > 0) { const q = onPopQueue(); if (q) set(q); return; }
        if (moveLine(-1)) return;
        browseHistory(-1);
        return;
      case 'down':
        if (menuOpen) { setMenuIndex((i) => (i >= menuLength - 1 ? 0 : i + 1)); return; }
        if (moveLine(1)) return;
        browseHistory(1);
        return;
      case 'left':
        ed.current.cursor = e.ctrl || e.alt ? moveWordLeft() : prevCp(ed.current.text, ed.current.cursor);
        bump();
        return;
      case 'right':
        ed.current.cursor = e.ctrl || e.alt ? moveWordRight() : nextCp(ed.current.text, ed.current.cursor);
        bump();
        return;
      case 'home': ed.current.cursor = e.ctrl ? 0 : lineBounds(ed.current.text, ed.current.cursor).start; bump(); return;
      case 'end': ed.current.cursor = e.ctrl ? ed.current.text.length : lineBounds(ed.current.text, ed.current.cursor).end; bump(); return;
      case 'backspace':
        if (e.alt || e.ctrl) { deleteWordBack(); return; }
        if (!ed.current.text && bashMode) { setBashMode(false); return; }
        backspace();
        return;
      case 'delete': del(); return;
      case 'char': {
        if (e.alt) {
          if (e.text === 'b') { ed.current.cursor = moveWordLeft(); bump(); }
          else if (e.text === 'f') { ed.current.cursor = moveWordRight(); bump(); }
          else if (e.text === 'd') { const { text: t, cursor: c } = ed.current; const p = moveWordRight(); if (p > c) { snapshot(); killRing.current = t.slice(c, p); set(t.slice(0, c) + t.slice(p), c); } }
          return;
        }
        if (!ed.current.text && !bashMode && e.text.startsWith('!')) {
          setBashMode(true);
          if (e.text.length > 1) insert(e.text.slice(1), true);
          return;
        }
        if (!ed.current.text && !bashMode && e.text === '?') { onToggleHelp(); return; }
        if (e.text.includes('\n') || e.text.includes('\r')) { insertPaste(e.text); return; }
        insert(e.text, true);
        return;
      }
      default:
        return;
    }
  };

  useRawInput(handle, { isActive });

  // ------------------------------------------------------------ render
  const lines = text.split('\n');
  let cursorLine = 0;
  let cursorCol = cursor;
  for (let i = 0; i < lines.length; i++) {
    if (cursorCol <= lines[i].length) { cursorLine = i; break; }
    cursorCol -= lines[i].length + 1;
    cursorLine = i + 1;
  }
  const promptChar = bashMode ? '!' : '>';
  const borderColor = bashMode ? theme.bashBorder : theme.promptBorder;

  const renderLine = (l: string, i: number) => {
    if (i !== cursorLine) return <Text key={i}>{l || ' '}</Text>;
    const before = l.slice(0, cursorCol);
    const at = cursorCol < l.length ? l.slice(cursorCol, nextCp(l, cursorCol)) : ' ';
    const after = cursorCol < l.length ? l.slice(nextCp(l, cursorCol)) : '';
    return (
      <Text key={i}>
        {before}
        <Text inverse>{at}</Text>
        {after}
      </Text>
    );
  };

  return (
    <Box flexDirection="column">
      {queue.length > 0 ? (
        <Box flexDirection="column" paddingX={1}>
          {queue.slice(0, 4).map((q, i) => (
            <Text key={i} color={theme.subtle} wrap="truncate-end">⏵ {q.split('\n')[0]}</Text>
          ))}
          {queue.length > 4 ? <Text color={theme.subtle}>… +{queue.length - 4} queued</Text> : null}
        </Box>
      ) : null}

      <Box borderStyle="round" borderColor={borderColor} paddingX={1} flexDirection="row">
        <Text color={bashMode ? theme.bashBorder : theme.subtle} bold>{promptChar} </Text>
        <Box flexDirection="column" flexGrow={1}>
          {search ? (
            <Text>
              <Text color={theme.subtle}>(reverse-i-search)`</Text>
              <Text color={theme.accent}>{search.query}</Text>
              <Text color={theme.subtle}>': </Text>
              {text}
            </Text>
          ) : empty ? (
            <Text>
              <Text inverse> </Text>
              <Text color={theme.subtle}>{bashMode ? 'shell command (esc to leave bash mode)' : 'Try "fix the failing test" · / commands · @ files · ! shell'}</Text>
            </Text>
          ) : (
            lines.map(renderLine)
          )}
        </Box>
      </Box>

      {slashMatches.length > 0 ? (
        <Box flexDirection="column" paddingX={2}>
          {slashMatches.slice(Math.max(0, safeMenuIndex - 7), Math.max(0, safeMenuIndex - 7) + 8).map((c, vi) => {
            const i = Math.max(0, safeMenuIndex - 7) + vi;
            const sel = i === safeMenuIndex;
            return (
              <Box key={c.name}>
                <Box width={22}><Text color={sel ? theme.accent : theme.text} bold={sel}>{sel ? '❯ ' : '  '}{c.name}{c.usage ? <Text color={theme.subtle}> {c.usage}</Text> : null}</Text></Box>
                <Text color={theme.subtle} wrap="truncate-end">{c.description}</Text>
              </Box>
            );
          })}
        </Box>
      ) : null}

      {atMatches.length > 0 ? (
        <Box flexDirection="column" paddingX={2}>
          {atMatches.map((f, i) => (
            <Text key={f} color={i === safeMenuIndex ? theme.accent : theme.subtle} bold={i === safeMenuIndex} wrap="truncate-middle">{i === safeMenuIndex ? '❯ ' : '  '}{f}</Text>
          ))}
        </Box>
      ) : null}

      {ctrlCHint ? <Box paddingX={2}><Text color={theme.warning}>Press ctrl+c again to exit</Text></Box> : null}

      {showHelp ? (
        <Box flexDirection="column" paddingX={2} marginTop={0}>
          <Text color={theme.subtle}>shift+tab  cycle permission modes     esc        interrupt · esc esc rewind/clear   ctrl+o  verbose transcript</Text>
          <Text color={theme.subtle}>!          bash mode                  @          mention a file                  /       slash commands</Text>
          <Text color={theme.subtle}>\⏎ ctrl+j  newline                    ↑/↓        history (↑ recovers queue)      ctrl+r  search history</Text>
          <Text color={theme.subtle}>ctrl+c     clear input / exit (×2)    ctrl+l     redraw screen                   ctrl+_  undo</Text>
          <Text color={theme.subtle}>ctrl+a/e   line start/end             ctrl+u/k   kill to start/end               ctrl+w  delete word · ctrl+y yank</Text>
          <Text color={theme.subtle}>ctrl+t     show/hide the task list</Text>
        </Box>
      ) : null}
    </Box>
  );
};
