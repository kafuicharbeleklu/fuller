import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from './theme.js';
import { SlashMenu, SuggestionList } from './SlashMenu.js';
import { HistorySearch, NEXT_SCOPE } from './HistorySearch.js';
import { loadPromptTimes } from '../session/history.js';
import { usageScore, type CommandUsage } from '../session/commandUsage.js';
import { useRawInput, type KeyEvent } from './useRawInput.js';
import { previousGrapheme, nextGrapheme, previousWord, nextWord, previousWhitespaceWord, sanitizePrompt } from './textInput.js';
import type { ScrollAction } from './FullscreenTranscript.js';
import { editPromptExternally } from './externalEditor.js';
import { keyString, currentKeybindings, chordPrefixes, type KeyAction } from './keybindings.js';
import { getFileIndex, fuzzyFilter } from '../utils/fileIndex.js';
import { readClipboardImage, attachmentFromFile, type ImageAttachment } from '../utils/imageClipboard.js';
import type { SlashCommand } from './commands.js';

export interface InputBoxProps {
  isActive: boolean;
  busy: boolean;
  queue: string[];
  history: string[];
  allHistory?: string[];
  sessionHistory?: string[];
  fullscreen?: boolean;
  cwd: string;
  commands: SlashCommand[];
  showHelp: boolean;
  /** Keep the first screen's prompt visually quiet. */
  compactEmpty?: boolean;
  /** Optional placeholder or suggestion hint when input is empty. null or "" disables it. */
  placeholder?: string | null;
  onSubmit: (text: string, attachments: ImageAttachment[]) => void;
  onSendNow?: (text: string, attachments: ImageAttachment[]) => void;
  onBackground?: () => boolean;
  /** Ctrl+X Ctrl+K pressed twice within 3 s: stop the background agents (returns how many were running). */
  onStopAgents?: () => number;
  onCommand: (command: string) => void;
  onBash: (command: string) => void;
  onInterrupt: () => void;
  onExit: () => void;
  onCycleMode: () => void;
  onClearScreen: () => void;
  onToggleVerbose: () => void;
  onToggleHelp: () => void;
  onToggleTodos?: () => void;
  onOpenDiff?: () => void;
  /** /color: the prompt bar's colour for this session (the bash colour still wins in ! mode). */
  promptColor?: string;
  /** Ctrl+X B: cycle what the /diff panel compares against. */
  onCycleDiffBase?: () => void;
  /** Ctrl/Alt+↑↓ while the /diff panel is open: scroll it (Claude Code: app:diffFileListUp/Down). */
  onDiffPanelScroll?: (delta: number) => boolean;
  /** x, y: the mouse position for wheel scrolls. */
  onScrollTranscript?: (action: ScrollAction, x?: number, y?: number) => void;
  onDoubleEscape: () => void;
  onPopQueue: () => string | undefined;
  onTakeQueue?: (empty: boolean) => { text: string; attachments: ImageAttachment[]; bash: boolean } | undefined;
  /** `hint` replaces the footer's left side, as Claude Code does for "Press Ctrl-C again to exit" or "paste again to expand". */
  /** alt+p: open the model picker, as in Claude Code. */
  onSwitchModel?: () => void;
  /** ctrl+z: suspend Fuller like a shell job (Claude Code); undo is ctrl+_. */
  onSuspend?: () => void;
  /** ← on an empty prompt. */
  onAgents?: () => void;
  /** A left click (1-based terminal cell), e.g. on the /diff panel. */
  onMouseClick?: (x: number, y: number) => void;
  /** The left button released at (x, y): the end of a selection in the diff panel. */
  onMouseRelease?: (x: number, y: number) => void;
  /** Text the app puts into the draft at the cursor (a new `id` each time), e.g. the diff panel's "[3 lines selected] ". */
  injected?: { id: number; text: string };
  /** Slash command usage, for the menu order. */
  commandUsage?: CommandUsage;
  onStateChange?: (state: { empty: boolean; bashMode: boolean; menuOpen: boolean; hint?: string; multiline?: boolean; killed?: boolean; stashed?: boolean; searching?: boolean }) => void;
}

interface EditorState {
  text: string;
  cursor: number;
}

interface EditorSnapshot extends EditorState {
  pastes: Map<number, string>;
  images: ImageAttachment[];
}

const PASTE_RE = /\[Pasted text #(\d+) \+(\d+) lines\]/g;
const PASTE_TAIL_RE = /\[Pasted text #(\d+) \+(\d+) lines\]$/;
const IMAGE_TAIL_RE = /\[Image #(\d+)\]$/;

export const InputBox: React.FC<InputBoxProps> = (props) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const {
    isActive, busy, queue, history: initialHistory, allHistory = initialHistory, sessionHistory = [], fullscreen = false, cwd, commands, showHelp, compactEmpty = false, placeholder,
    onSubmit, onCommand, onBash, onInterrupt, onExit, onCycleMode, onClearScreen,
    onToggleVerbose, onToggleHelp, onToggleTodos, onOpenDiff, onCycleDiffBase, onDiffPanelScroll, onScrollTranscript, onDoubleEscape, onPopQueue, onStateChange, onSwitchModel, onSuspend, onAgents, onMouseClick, onMouseRelease, injected, commandUsage = {}, onSendNow, onBackground, onStopAgents, onTakeQueue, promptColor,
  } = props;

  const ed = useRef<EditorState>({ text: '', cursor: 0 });
  const undo = useRef<EditorSnapshot[]>([]);
  const lastTypeAt = useRef(0);
  /** Killed texts, most recent last (readline's kill ring; Ctrl+Y pastes the last, Alt+Y cycles). */
  const killRing = useRef<string[]>([]);
  /** The text Ctrl+Y or Alt+Y just inserted, so that Alt+Y can replace it with an older kill. */
  const lastYank = useRef<{ start: number; length: number; index: number } | null>(null);
  const pastes = useRef(new Map<number, string>());
  const pasteCounter = useRef(0);
  const images = useRef<ImageAttachment[]>([]);
  const imageCounter = useRef(0);
  const [imageHint, setImageHint] = useState<string | null>(null);
  const [inputWarning, setInputWarning] = useState<string | null>(null);
  const history = useRef<string[]>(initialHistory);
  const sessionPrompts = useRef<string[]>(sessionHistory);
  const promptTimes = useRef<Map<string, number> | null>(null);
  if (!promptTimes.current) promptTimes.current = loadPromptTimes();
  const searchDraft = useRef<EditorState>({ text: '', cursor: 0 });
  const sendChord = useRef(false);
  /** Claude Code waits 3 s for the second key of a chord. */
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStopAgents = useRef(0);
  const historyIndex = useRef(-1);
  const draft = useRef('');
  const lastCtrlC = useRef(0);
  const lastEsc = useRef(0);
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const [bashMode, setBashMode] = useState(false);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [search, setSearch] = useState<{ query: string; index: number; scope: 'session' | 'project' | 'all' } | null>(null);
  const [midSlashOpen, setMidSlashOpen] = useState(false);
  const [menuNavigated, setMenuNavigated] = useState(false);
  const [fileIndex, setFileIndex] = useState<string[]>([]);
  /** "Press Ctrl-C again to exit" / "Press Ctrl-D again to exit" while the second press is awaited. */
  const [exitHint, setExitHint] = useState<string | null>(null);
  const lastCtrlD = useRef(0);
  /** Last collapsed paste, expanded in place when the same text is pasted again. */
  const lastPaste = useRef<{ label: string; text: string } | null>(null);
  const [pasteHint, setPasteHint] = useState(false);
  /** Text was deleted into the kill ring and can be yanked back (Claude Code: "Ctrl+Y to paste deleted text"). */
  const [killed, setKilled] = useState(false);
  /** ctrl+s: prompt put aside with its cursor, pastes and images (Claude Code "stash"). */
  const stash = useRef<{ text: string; cursor: number; pastes: Map<number, string>; images: ImageAttachment[]; bashMode: boolean } | null>(null);
  const [stashed, setStashed] = useState(false);
  const remember = (deleted: string) => {
    if (!deleted) return;
    killRing.current = [...killRing.current.slice(-9), deleted];
    setKilled(true);
  };
  /** A key that starts a bound chord, waiting for the second key (3 s, as Claude Code). */
  const pendingUserChord = useRef<{ key: string; at: number } | null>(null);

  const { text, cursor } = ed.current;
  const empty = text.length === 0;

  // ------------------------------------------------------------ menus
  const slashToken = text.slice(0, cursor).match(/(?:^|\s)(\/[^\s/]*)$/)?.[1];
  const midSlash = !!slashToken && cursor - slashToken.length > 0;
  const slashActive = !bashMode && !search && !menuDismissed && !!slashToken;
  const slashMatches = slashActive
    ? commands.filter((c) => c.name.startsWith(slashToken!) || (midSlash ? c.name.split(':').at(-1)?.startsWith(slashToken!.slice(1)) : slashToken!.length > 1 && c.name.includes(slashToken!.slice(1))))
      // Claude Code puts the commands used most, and most recently, first (/co → /copy).
      .sort((a, b) => Number(b.name.startsWith(slashToken!)) - Number(a.name.startsWith(slashToken!)) || usageScore(commandUsage, b.name) - usageScore(commandUsage, a.name) || a.name.localeCompare(b.name))
    : [];
  const slashListVisible = slashMatches.length > 0 && (!midSlash || fullscreen || midSlashOpen);

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

  const menuOpen = slashListVisible || atMatches.length > 0;
  const menuLength = slashMatches.length || atMatches.length;
  const safeMenuIndex = Math.min(menuIndex, Math.max(0, menuLength - 1));

  useEffect(() => { if (empty) setKilled(false); }, [empty]);

  const multiline = text.includes('\n');
  const inputHint = exitHint ?? (pasteHint ? 'paste again to expand' : undefined);
  useEffect(() => {
    onStateChange?.({ empty, bashMode, menuOpen, hint: inputHint, multiline, killed: killed && !empty, stashed, searching: !!search && fullscreen });
  }, [empty, bashMode, menuOpen, onStateChange, inputHint, multiline, killed, stashed, !!search && fullscreen]);

  // ------------------------------------------------------------ editor helpers
  const snapshot = (typing = false) => {
    const now = Date.now();
    if (typing && now - lastTypeAt.current < 600 && undo.current.length) { lastTypeAt.current = now; return; }
    lastTypeAt.current = typing ? now : 0;
    undo.current.push({ ...ed.current, pastes: new Map(pastes.current), images: [...images.current] });
    if (undo.current.length > 100) undo.current.shift();
  };
  const set = (t: string, c = t.length) => {
    ed.current = { text: t, cursor: Math.max(0, Math.min(c, t.length)) };
    // Bump first. The text lives in a ref: in Ink's legacy root each setState
    // renders on its own, and a render that reads the new text but bails out
    // (a no-op setState) keeps its effect deps, so the effects below would
    // later be skipped (lost "@" file list, stale footer state).
    bump();
    setInputWarning(null);
    setMenuDismissed(false);
    setMenuIndex(0);
    setMidSlashOpen(false);
    setMenuNavigated(false);
  };
  const insert = (s: string, typing = false) => {
    snapshot(typing);
    const { text: t, cursor: c } = ed.current;
    set(t.slice(0, c) + s + t.slice(c), c + s.length);
    historyIndex.current = -1;
  };
  const injectedId = useRef(0);
  useEffect(() => {
    if (!injected || injected.id === injectedId.current) return;
    injectedId.current = injected.id;
    if (!ed.current.text.includes(injected.text)) insert(injected.text);
  }, [injected]);
  const prevCp = previousGrapheme;
  const nextCp = nextGrapheme;
  const backspace = () => {
    const { text: t, cursor: c } = ed.current;
    if (c === 0) return;
    snapshot();
    const head = t.slice(0, c);
    const m = head.match(PASTE_TAIL_RE);
    if (m) { pastes.current.delete(Number(m[1])); set(head.slice(0, -m[0].length) + t.slice(c), c - m[0].length); return; }
    const im = head.match(IMAGE_TAIL_RE);
    if (im) { images.current = images.current.filter((a) => a.n !== Number(im[1])); set(head.slice(0, -im[0].length) + t.slice(c), c - im[0].length); return; }
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
    return previousWord(t, c);
  };
  const moveWordRight = () => {
    const { text: t, cursor: c } = ed.current;
    return nextWord(t, c);
  };
  const deleteWordBack = (whitespace = false) => {
    const { text: t, cursor: c } = ed.current;
    const p = whitespace ? previousWhitespaceWord(t, c) : moveWordLeft();
    if (p === c) return;
    snapshot();
    remember(t.slice(p, c));
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
    if (end === c) { if (c < t.length) { snapshot(); remember('\n'); set(t.slice(0, c) + t.slice(c + 1), c); } return; }
    snapshot();
    remember(t.slice(c, end));
    set(t.slice(0, c) + t.slice(end), c);
  };
  const killToStart = () => {
    const { text: t, cursor: c } = ed.current;
    const { start } = lineBounds(t, c);
    if (start === c) return;
    snapshot();
    remember(t.slice(start, c));
    set(t.slice(0, start) + t.slice(c), start);
  };
  const yank = () => {
    const ring = killRing.current;
    if (!ring.length) return;
    const text = ring[ring.length - 1];
    const start = ed.current.cursor;
    insert(text);
    lastYank.current = { start, length: text.length, index: ring.length - 1 };
    setKilled(false);
  };
  /** Alt+Y right after a yank: replace the yanked text with the previous kill (readline's yank-pop). */
  const yankPop = () => {
    const y = lastYank.current;
    const ring = killRing.current;
    if (!y || ring.length < 2) return;
    const index = (y.index - 1 + ring.length) % ring.length;
    const text = ring[index];
    const t = ed.current.text;
    if (t.slice(y.start, y.start + y.length) !== ring[y.index]) { lastYank.current = null; return; }
    set(t.slice(0, y.start) + text + t.slice(y.start + y.length), y.start + text.length);
    lastYank.current = { start: y.start, length: text.length, index };
  };
  const undoOnce = () => {
    const prev = undo.current.pop();
    if (prev) {
      ed.current = { text: prev.text, cursor: prev.cursor };
      bump(); // before any other state update, see set()
      pastes.current = new Map(prev.pastes);
      images.current = [...prev.images];
    }
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
    let normalized = raw.replace(/\r\n?/g, '\n');
    // Claude Code: a paste that starts with ! into an empty prompt switches to shell mode.
    if (!ed.current.text && !bashMode && normalized.startsWith('!')) { setBashMode(true); normalized = normalized.slice(1); if (!normalized) return; }
    const lines = normalized.split('\n').length;
    const previous = lastPaste.current;
    lastPaste.current = null;
    setPasteHint(false);
    // Like Claude Code, pasting the same text again expands its placeholder in place.
    if (previous && previous.text === normalized && ed.current.text.slice(0, ed.current.cursor).endsWith(previous.label)) {
      const { text: t, cursor: c } = ed.current;
      snapshot();
      set(t.slice(0, c - previous.label.length) + normalized + t.slice(c), c - previous.label.length + normalized.length);
      return;
    }
    if (lines > 3 || normalized.length > 800) {
      const n = ++pasteCounter.current;
      pastes.current.set(n, normalized);
      // Claude Code counts the added lines, i.e. the line breaks.
      const label = `[Pasted text #${n} +${lines - 1} lines]`;
      insert(label);
      lastPaste.current = { label, text: normalized };
      setPasteHint(true);
    } else {
      insert(normalized);
    }
  };

  const pasteImage = async () => {
    setImageHint('Reading clipboard…');
    try {
      const img = await readClipboardImage();
      if (!img) { setImageHint('No image in the clipboard'); setTimeout(() => setImageHint(null), 2000); return; }
      const n = ++imageCounter.current;
      const att = attachmentFromFile(img.path, n);
      images.current.push(att);
      insert(`[Image #${n}]`);
      setImageHint(null);
    } catch (err: any) {
      setImageHint(String(err?.message ?? err));
      setTimeout(() => setImageHint(null), 3000);
    }
  };

  const openEditor = () => {
    const wasRaw = process.stdin.isRaw;
    try {
      if (wasRaw) process.stdin.setRawMode(false);
      const edited = editPromptExternally(ed.current.text);
      snapshot();
      set(edited);
    } catch (error: any) {
      setInputWarning(`Editor: ${error?.message ?? String(error)}`);
    } finally {
      if (wasRaw) process.stdin.setRawMode(true);
      onClearScreen();
    }
  };

  const resetEditor = () => {
    ed.current = { text: '', cursor: 0 };
    bump(); // before any other state update, see set()
    undo.current = [];
    pastes.current.clear();
    images.current = [];
    historyIndex.current = -1;
    draft.current = '';
    setMenuDismissed(false);
    setMenuIndex(0);
    setSearch(null);
    setInputWarning(null);
    bump();
  };

  const pushHistory = (t: string) => {
    if (history.current[history.current.length - 1] !== t) history.current.push(t);
    if (sessionPrompts.current.at(-1) !== t) sessionPrompts.current.push(t);
    promptTimes.current?.set(t, Date.now());
  };

  const submit = (immediate = false) => {
    const raw = ed.current.text;
    const cleaned = sanitizePrompt(raw);
    let removed = cleaned.removed;
    for (const [key, value] of pastes.current) {
      const paste = sanitizePrompt(value);
      removed += paste.removed;
      if (paste.removed) pastes.current.set(key, paste.text);
    }
    if (removed) {
      if (cleaned.removed) set(cleaned.text, Math.min(ed.current.cursor, cleaned.text.length));
      setInputWarning(`Removed ${removed} invisible character${removed === 1 ? '' : 's'} · review and press Enter to send`);
      return;
    }
    const trimmed = raw.trim();
    if (!trimmed) { if (immediate && !bashMode) onSendNow?.('', []); return; }
    if ([...raw.matchAll(PASTE_RE)].some((match) => !pastes.current.has(Number(match[1])))) {
      setInputWarning('Pasted content is unavailable. Paste it again before sending.');
      return;
    }
    if (bashMode) {
      const command = expandPastes(raw).trim();
      pushHistory('!' + command);
      resetEditor();
      setBashMode(false);
      onBash(command);
      return;
    }
    const expanded = expandPastes(raw).replace(/\[Image #(\d+)\]/g, (m, n) => {
      const att = images.current.find((a) => a.n === Number(n));
      return att ? `[Image #${n}: ${att.name}]` : m;
    }).trim();
    const attachments = images.current.map((a, i) => ({ ...a, n: i + 1 }));
    pushHistory(expanded);
    resetEditor();
    if (expanded.startsWith('/') && !expanded.includes('\n')) onCommand(expanded);
    else if (immediate && onSendNow) onSendNow(expanded, attachments);
    else onSubmit(expanded, attachments);
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
      if (midSlash && slashToken) {
        const { text: t, cursor: c } = ed.current;
        snapshot();
        set(t.slice(0, c - slashToken.length) + cmd.name + ' ' + t.slice(c), c - slashToken.length + cmd.name.length + 1);
        return;
      }
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

  const searchMatches = (query: string, scope = search?.scope ?? 'all'): string[] => {
    const q = query.toLowerCase();
    const source = scope === 'session' ? sessionPrompts.current : scope === 'project' ? history.current : [...allHistory, ...sessionPrompts.current];
    return [...new Set([...source].reverse())].filter((entry) => !q || entry.toLowerCase().includes(q));
  };

  const startSearch = () => {
    searchDraft.current = { ...ed.current };
    // Claude Code starts searching "everywhere".
    const scope = 'all';
    setSearch({ query: '', index: 0, scope });
    set(searchMatches('', scope)[0] ?? '');
  };
  const cancelSearch = () => { setSearch(null); set(searchDraft.current.text, searchDraft.current.cursor); };
  const updateSearch = (query: string, index: number, scope = search!.scope) => {
    const matches = searchMatches(query, scope);
    const selected = Math.max(0, Math.min(index, matches.length - 1));
    setSearch({ query, index: selected, scope });
    set(matches[selected] ?? '');
  };
  const acceptSuggestion = () => {
    if (ed.current.text || bashMode || !placeholder) return false;
    insert(placeholder.match(/^Try "([\s\S]*)"$/)?.[1] ?? placeholder);
    return true;
  };

  const toggleStash = () => {
      // Claude Code: stash a non-empty prompt, restore the stash on an empty one.
      if (ed.current.text) {
        // The input mode goes with it: a stashed `!` command comes back as a shell command (Claude Code 2.1.280).
        stash.current = { ...ed.current, pastes: new Map(pastes.current), images: [...images.current], bashMode };
        resetEditor();
        setBashMode(false);
        setStashed(true);
      } else if (stash.current) {
        const saved = stash.current;
        stash.current = null;
        set(saved.text, saved.cursor);
        pastes.current = new Map(saved.pastes);
        images.current = [...saved.images];
        setBashMode(saved.bashMode);
        setStashed(false);
      }
  };

  // ------------------------------------------------------------ key handling
  const handle = (e: KeyEvent) => {
    if (e.name === 'mouse') {
      if (e.mouse?.button === 64) onScrollTranscript?.('lineUp', e.mouse.x, e.mouse.y);
      if (e.mouse?.button === 65) onScrollTranscript?.('lineDown', e.mouse.x, e.mouse.y);
      if (e.mouse?.button === 0 && !e.mouse.release) onMouseClick?.(e.mouse.x, e.mouse.y);
      if (e.mouse?.button === 0 && e.mouse.release) onMouseRelease?.(e.mouse.x, e.mouse.y);
      return;
    }
    // Only Alt+Y right after Ctrl+Y (or another Alt+Y) cycles the kill ring.
    if (!(e.name === 'char' && ((e.alt && e.text === 'y') || (e.ctrl && e.text === 'y')))) lastYank.current = null;
    // User bindings (~/.fuller/keybindings.json or ~/.claude/keybindings.json, reloaded when they change).
    const keybindings = currentKeybindings();
    const single = keyString(e);
    let key = single;
    const pending = pendingUserChord.current;
    pendingUserChord.current = null;
    if (pending && Date.now() - pending.at < 3000) {
      const chord = `${pending.key} ${single}`;
      if (Object.prototype.hasOwnProperty.call(keybindings, chord)) key = chord;
      // Not a bound chord: Ctrl+X goes on to the built-in chords; any other prefix key is dropped.
      else if (pending.key === 'ctrl+x') sendChord.current = true;
    }
    if (key === single && chordPrefixes(keybindings).has(single) && !Object.prototype.hasOwnProperty.call(keybindings, single)) {
      pendingUserChord.current = { key: single, at: Date.now() };
      return;
    }
    if (Object.prototype.hasOwnProperty.call(keybindings, key)) {
      const action: KeyAction | null = keybindings[key];
      if (action === null) return;
      if (key.includes(' ')) sendChord.current = false;
      switch (action) {
        case 'transcript': onToggleVerbose(); return;
        case 'diff': onOpenDiff?.(); return;
        case 'externalEditor': openEditor(); return;
        case 'tasks': onToggleTodos?.(); return;
        case 'redraw': onClearScreen(); return;
        case 'historySearch': startSearch(); return;
        case 'undo': undoOnce(); return;
        case 'cycleMode': onCycleMode(); return;
        case 'stash': toggleStash(); return;
        case 'imagePaste': void pasteImage(); return;
        case 'modelPicker': onSwitchModel?.(); return;
        case 'sendNow': submit(true); return;
        case 'killAgents': onStopAgents?.(); return;
        case 'cycleDiffBase': onCycleDiffBase?.(); return;
      }
    }
    if (e.name === 'paste') { insertPaste(e.text); return; }
    if (lastPaste.current) { lastPaste.current = null; setPasteHint(false); }

    if (search) {
      if (e.name === 'escape') { if (fullscreen) cancelSearch(); else setSearch(null); return; }
      if (e.name === 'tab' || e.name === 'return') {
        setSearch(null);
        if (!fullscreen && e.name === 'return') submit();
        return;
      }
      if (e.name === 'char' && e.ctrl && (e.text === 'c' || e.text === 'g')) { cancelSearch(); return; }
      if (fullscreen && e.name === 'char' && e.ctrl && e.text === 's') {
        const scope = NEXT_SCOPE[search.scope];
        updateSearch(search.query, 0, scope);
        return;
      }
      if ((e.name === 'char' && e.ctrl && e.text === 'r') || (fullscreen && (e.name === 'up' || e.name === 'down'))) {
        const count = searchMatches(search.query).length;
        // Fullscreen lists older prompts above the selection, as Claude Code does: ↑ goes back in time.
        const step = fullscreen ? (e.name === 'up' ? 1 : e.name === 'down' ? -1 : 1) : e.name === 'up' ? -1 : 1;
        updateSearch(search.query, count ? (search.index + step + count) % count : 0);
        return;
      }
      if (e.name === 'backspace') {
        if (!search.query) { cancelSearch(); return; }
        updateSearch(search.query.slice(0, previousGrapheme(search.query, search.query.length)), 0);
        return;
      }
      if (e.name === 'char' && !e.ctrl && !e.alt) updateSearch(search.query + e.text, 0);
      return;
    }

    if (sendChord.current) {
      sendChord.current = false;
      if (chordTimer.current) { clearTimeout(chordTimer.current); chordTimer.current = null; }
      if (e.name === 'char' && e.ctrl && e.text === 's') { submit(true); return; }
      // Ctrl+X Ctrl+E: external editor; Ctrl+X Ctrl+B: background (for tmux, where Ctrl+B is the prefix).
      if (e.name === 'char' && e.ctrl && e.text === 'e') { openEditor(); return; }
      if (e.name === 'char' && e.ctrl && e.text === 'b') { onBackground?.(); return; }
      // Ctrl+X Ctrl+K: stop the background agents, on a second press within 3 s.
      if (e.name === 'char' && e.ctrl && e.text === 'k') {
        if (Date.now() - lastStopAgents.current < 3000) {
          lastStopAgents.current = 0;
          setExitHint(null);
          onStopAgents?.();
        } else {
          lastStopAgents.current = Date.now();
          setExitHint('Press ctrl+x ctrl+k again to stop background agents');
          setTimeout(() => setExitHint((h) => (h?.includes('ctrl+k') ? null : h)), 3000);
        }
        return;
      }
      // Ctrl+X B: the /diff panel compares against the next base (Claude Code).
      if (e.name === 'char' && !e.ctrl && !e.alt && e.text.toLowerCase() === 'b') { onCycleDiffBase?.(); return; }
    }
    if (e.name === 'char' && e.ctrl) {
      switch (e.text) {
        case 'c':
          if (busy) { onInterrupt(); return; }
          if (!ed.current.text && bashMode) { setBashMode(false); return; }
          if (!ed.current.text && Date.now() - lastCtrlC.current < 1500) { onExit(); return; }
          // Claude Code clears the input and arms the exit on the same press.
          if (ed.current.text) resetEditor();
          lastCtrlC.current = Date.now();
          setExitHint('Press Ctrl-C again to exit');
          setTimeout(() => setExitHint((h) => (h?.includes('Ctrl-C') ? null : h)), 1500);
          return;
        case 'd':
          // Claude Code: on an empty prompt, Ctrl+D exits only when pressed twice within 800 ms.
          if (!ed.current.text && !busy) {
            if (Date.now() - lastCtrlD.current < 800) { lastCtrlD.current = 0; setExitHint(null); onExit(); return; }
            lastCtrlD.current = Date.now();
            setExitHint('Press Ctrl-D again to exit');
            setTimeout(() => setExitHint((h) => (h?.includes('Ctrl-D') ? null : h)), 800);
            return;
          }
          del();
          return;
        case 'o': onToggleVerbose(); return;
        case 'g': openEditor(); return;
        case 't': onToggleTodos?.(); return;
        case 'v': void pasteImage(); return;
        case 'l': onClearScreen(); return;
        case 'r': startSearch(); return;
        case 'x':
          sendChord.current = true;
          if (chordTimer.current) clearTimeout(chordTimer.current);
          chordTimer.current = setTimeout(() => { sendChord.current = false; chordTimer.current = null; }, 3000);
          return;
        case '_': undoOnce(); return;
        case 'z': if (onSuspend) onSuspend(); else undoOnce(); return;
        case 's': toggleStash(); return;
        case 'a': ed.current.cursor = lineBounds(ed.current.text, ed.current.cursor).start; bump(); return;
        case 'e': ed.current.cursor = lineBounds(ed.current.text, ed.current.cursor).end; bump(); return;
        case 'b': if (onBackground?.()) return; ed.current.cursor = prevCp(ed.current.text, ed.current.cursor); bump(); return;
        case 'f': ed.current.cursor = nextCp(ed.current.text, ed.current.cursor); bump(); return;
        case 'k': killToEnd(); return;
        case 'u': if (!ed.current.text && bashMode) { setBashMode(false); return; } killToStart(); return;
        case 'w': case 'h': if (e.text === 'h') backspace(); else deleteWordBack(true); return;
        case 'y': yank(); return;
        case 'j': insert('\n'); return;
        default: return;
      }
    }

    switch (e.name) {
      case 'pageup': onScrollTranscript?.('up'); return;
      case 'pagedown': onScrollTranscript?.('down'); return;
      case 'escape': {
        if (showHelp) { onToggleHelp(); return; }
        if (menuOpen || slashActive) { setMenuDismissed(true); return; }
        if (busy) { onInterrupt(); lastEsc.current = 0; return; }
        if (bashMode && !ed.current.text) { setBashMode(false); return; }
        const now = Date.now();
        if (now - lastEsc.current < 600) {
          lastEsc.current = 0;
          if (ed.current.text) {
            // Claude Code clears the input and keeps the draft in the history: ↑ brings it back.
            const draftText = ed.current.text;
            if (draftText.trim() && history.current[history.current.length - 1] !== draftText) history.current.push(draftText);
            resetEditor();
          } else onDoubleEscape();
          return;
        }
        lastEsc.current = now;
        return;
      }
      case 'tab':
        if (e.shift) { onCycleMode(); return; }
        // Shell mode: Tab completes from the ! commands already run (most recent first), as in Claude Code.
        if (bashMode && !e.ctrl && !e.alt) {
          const typed = ed.current.text;
          const match = [...history.current].reverse().find((h) => h.startsWith('!') && h.length > typed.length + 1 && h.slice(1).startsWith(typed));
          if (match) { snapshot(); set(match.slice(1)); }
          return;
        }
        if (midSlash && slashMatches.length && !fullscreen && !midSlashOpen && (slashMatches.length > 1 || slashToken === '/')) { setMidSlashOpen(true); return; }
        if (menuOpen || slashMatches.length) completeMenu(false);
        else acceptSuggestion();
        return;
      case 'return': {
        if (e.raw === '\n' || e.alt || e.shift) { insert('\n'); return; }
        if (e.ctrl) { submit(true); return; }
        const { text: t, cursor: c } = ed.current;
        const { end } = lineBounds(t, c);
        if (end === c && t.slice(0, c).endsWith('\\')) { snapshot(); set(t.slice(0, c - 1) + '\n' + t.slice(c), c); return; }
        if (menuOpen && (!midSlash || menuNavigated)) { completeMenu(true); return; }
        submit();
        return;
      }
      case 'up':
        if ((e.ctrl || e.alt) && onDiffPanelScroll?.(-1)) return;
        if (menuOpen) { setMenuNavigated(true); setMenuIndex((i) => (i <= 0 ? menuLength - 1 : i - 1)); return; }
        if (lineBounds(ed.current.text, ed.current.cursor).start === 0 && queue.length > 0) {
          const entry = onTakeQueue?.(!ed.current.text);
          const q = onTakeQueue ? entry?.text : onPopQueue();
          if (q) {
            snapshot();
            for (const attachment of entry?.attachments ?? []) images.current.push({ ...attachment, n: ++imageCounter.current });
            if (entry?.bash) setBashMode(true);
            set(q + (ed.current.text ? '\n' + ed.current.text : ''));
          }
          return;
        }
        if (moveLine(-1)) return;
        browseHistory(-1);
        return;
      case 'down':
        if ((e.ctrl || e.alt) && onDiffPanelScroll?.(1)) return;
        if (menuOpen) { setMenuNavigated(true); setMenuIndex((i) => midSlash && !menuNavigated ? 0 : (i >= menuLength - 1 ? 0 : i + 1)); return; }
        if (moveLine(1)) return;
        browseHistory(1);
        return;
      case 'left':
        // Claude Code: ← on an empty prompt opens the agents view.
        if (!ed.current.text && !e.ctrl && !e.alt && !bashMode && onAgents) { onAgents(); return; }
        ed.current.cursor = e.ctrl || e.alt ? moveWordLeft() : prevCp(ed.current.text, ed.current.cursor);
        bump();
        return;
      case 'right':
        if (!e.ctrl && !e.alt && acceptSuggestion()) return;
        ed.current.cursor = e.ctrl || e.alt ? moveWordRight() : nextCp(ed.current.text, ed.current.cursor);
        bump();
        return;
      case 'home': if (fullscreen && e.ctrl) { onScrollTranscript?.('top'); return; } ed.current.cursor = e.ctrl ? 0 : lineBounds(ed.current.text, ed.current.cursor).start; bump(); return;
      case 'end': if (fullscreen && e.ctrl) { onScrollTranscript?.('bottom'); return; } ed.current.cursor = e.ctrl ? ed.current.text.length : lineBounds(ed.current.text, ed.current.cursor).end; bump(); return;
      case 'backspace':
        if (e.alt || e.ctrl) { deleteWordBack(); return; }
        if (!ed.current.text && bashMode) { setBashMode(false); return; }
        backspace();
        return;
      case 'delete': del(); return;
      case 'char': {
        if (e.alt) {
          if (e.text === 'y') { yankPop(); return; }
          if (e.text === 'v') { void pasteImage(); return; }
          if (e.text === 'p') { onSwitchModel?.(); return; }
          if (e.text === 'b') { ed.current.cursor = moveWordLeft(); bump(); }
          else if (e.text === 'f') { ed.current.cursor = moveWordRight(); bump(); }
          else if (e.text === 'd') { const { text: t, cursor: c } = ed.current; const p = moveWordRight(); if (p > c) { snapshot(); remember(t.slice(c, p)); set(t.slice(0, c) + t.slice(p), c); } }
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
  const promptChar = bashMode ? '!' : '❯';
  const borderColor = bashMode ? theme.bashBorder : promptColor ?? theme.promptBorder;

  const ghostSuffix = midSlash && !fullscreen && !midSlashOpen && slashMatches.length > 0 && cursor === text.length ? slashMatches[0].name.slice(slashToken!.length) : '';
  // A complete slash command at the start of the prompt is shown in the suggestion colour, as in Claude Code.
  const commandLength = (() => {
    if (bashMode || !text.startsWith('/')) return 0;
    const name = text.match(/^\/\S+/)?.[0] ?? '';
    return commands.some((command) => command.name === name || command.aliases?.includes(name)) ? name.length : 0;
  })();
  const colorCommand = (part: string, offset: number) => {
    if (!commandLength || offset >= commandLength) return part;
    const cut = commandLength - offset;
    return <><Text color={theme.permission}>{part.slice(0, cut)}</Text>{part.slice(cut)}</>;
  };
  const renderLine = (l: string, i: number) => {
    if (i !== cursorLine) return <Text key={i}>{i === 0 ? colorCommand(l, 0) : l || ' '}</Text>;
    const before = l.slice(0, cursorCol);
    const at = cursorCol < l.length ? l.slice(cursorCol, nextCp(l, cursorCol)) : ghostSuffix[0] || ' ';
    const after = cursorCol < l.length ? l.slice(nextCp(l, cursorCol)) : '';
    return (
      <Text key={i}>
        {i === 0 ? colorCommand(before, 0) : before}
        <Text inverse>{at}</Text>
        {i === 0 ? colorCommand(after, before.length + at.length) : after}
        {ghostSuffix ? <Text color={theme.subtle}>{ghostSuffix.slice(1)}{slashMatches.length > 1 ? ` +${slashMatches.length - 1}` : ''}</Text> : null}
      </Text>
    );
  };

  const placeholderText = useMemo(() => {
    if (compactEmpty || placeholder === null || placeholder === '') return '';
    return placeholder ?? '';
  }, [bashMode, compactEmpty, placeholder]);

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

      {/* Suggestions sit above the prompt, in place of the hint line, as in Claude Code. */}
      {slashListVisible ? <SlashMenu commands={slashMatches} selectedIndex={midSlash && !menuNavigated ? -1 : safeMenuIndex} width={stdout.columns || 80} query={slashToken?.slice(1)} /> : null}
      {atMatches.length > 0 ? (
        <SuggestionList items={atMatches.map((file) => ({ label: `+ ${file}` }))} selectedIndex={menuNavigated ? safeMenuIndex : -1} width={stdout.columns || 80} query={atToken?.slice(1)} />
      ) : null}

      {search && fullscreen ? <HistorySearch query={search.query} scope={search.scope} matches={searchMatches(search.query)} index={search.index} timeOf={(entry) => promptTimes.current?.get(entry)} /> : null}
      <Box display={search && fullscreen ? 'none' : 'flex'} borderStyle="single" borderColor={borderColor} borderTop borderBottom borderLeft={false} borderRight={false} paddingRight={1} flexDirection="row">
        <Text color={bashMode ? theme.bashBorder : busy ? theme.subtle : theme.text}>{promptChar} </Text>
        <Box flexDirection="column" flexGrow={1}>
          {search ? (
            <Text>
              <Text color={theme.subtle}>{fullscreen ? 'Search history: ' : '(reverse-i-search)`'}</Text>
              <Text color={theme.accent}>{search.query}</Text>
              {!fullscreen ? <><Text color={theme.subtle}>': </Text>{text || 'No matches'}</> : null}
            </Text>
          ) : empty ? (
            // The cursor sits on the first character of the placeholder, as in Claude Code.
            <Text>
              <Text inverse dimColor={!!placeholderText}>{placeholderText ? placeholderText.slice(0, nextCp(placeholderText, 0)) : ' '}</Text>
              {placeholderText ? <Text dimColor>{placeholderText.slice(nextCp(placeholderText, 0))}</Text> : null}
            </Text>
          ) : (
            lines.map(renderLine)
          )}
        </Box>
      </Box>


      {imageHint ? <Box paddingX={2}><Text color={theme.subtle}>{imageHint}</Text></Box> : null}
      {inputWarning ? <Box paddingX={2}><Text color={theme.warning}>{inputWarning}</Text></Box> : null}

    </Box>
  );
};
