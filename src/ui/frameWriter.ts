import fs from 'node:fs';
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';

const DEBUG_FILE = process.env.FULLER_DEBUG_FRAMES;
function debug(line: string) {
  if (DEBUG_FILE) fs.appendFileSync(DEBUG_FILE, line + '\n');
}

/**
 * Ink erases the previous frame with `eraseLines(N)` where N is the number of
 * *logical* lines it wrote. When the terminal is resized, most terminals
 * (GNOME Terminal/VTE, Konsole, iTerm2, kitty, Windows Terminal, tmux…) reflow
 * the existing text, so those N logical lines now occupy a different number of
 * physical rows and Ink leaves ghost fragments behind. This writer sits in front
 * of stdout, remembers the last dynamic frame and rewrites Ink's erase sequence
 * with the correct number of physical rows for the *current* width.
 */
/**
 * Ink erases with EL 2 (`ESC[2K`). VTE (GNOME Terminal) mishandles rows that were
 * erased with EL 2 when it later reflows the buffer on a resize: it inserts spurious
 * blank rows and moves the cursor, so the next erase misses the frame. EL 0 from
 * column 1 (`ESC[G ESC[K`) clears exactly the same cells and reflows cleanly.
 */
const ERASE_TO_END = '\x1b[K';
const CURSOR_UP = '\x1b[1A';
const CURSOR_LEFT = '\x1b[G';
const ERASE_RE = /^(?:\x1b\[2K(?:\x1b\[1A)?)+\x1b\[G/;
const CLEAR_SCREEN = '\x1b[2J';

export function eraseLines(count: number): string {
  if (count <= 0) return '';
  let out = CURSOR_LEFT;
  for (let i = 0; i < count; i++) out += ERASE_TO_END + (i < count - 1 ? CURSOR_UP : '');
  return out;
}

/**
 * Physical rows used by a frame. The frame is written without Ink's trailing
 * newline, so the cursor stays on the last row of the frame: when the terminal
 * height shrinks, VTE otherwise treats the blank cursor row as slack and moves the
 * cursor away from the frame, which breaks cursor-relative erasing.
 */
export function physicalRows(lines: string[], columns: number, reflow = true): number {
  if (lines.length === 0) return 0;
  if (!reflow) return lines.length;
  const cols = Math.max(1, columns);
  return lines.reduce((acc, line) => acc + Math.max(1, Math.ceil(stringWidth(line) / cols)), 0);
}

export interface FrameWriterState {
  lastFrame: string[];
  expectStatic: boolean;
  /** True when the last erase had to cover more rows than lines (the previous frame had wrapped). */
  lastEraseWrapped?: boolean;
}

/** Pure transformation of one stdout chunk; exported for tests. */
export function transformChunk(chunk: string, state: FrameWriterState, columns: number, reflow: boolean): string {
  // log-update's clear() with a zero count writes an empty string: the next chunk is static output.
  if (chunk === '') {
    state.expectStatic = true;
    state.lastFrame = [];
    return chunk;
  }
  const m = chunk.match(ERASE_RE);
  let rest = chunk;
  let prefix = '';
  if (m) {
    const inkCount = (m[0].match(/\x1b\[2K/g) ?? []).length;
    rest = chunk.slice(m[0].length);
    const rows = state.lastFrame.length > 0 ? physicalRows(state.lastFrame, columns, reflow) : inkCount;
    state.lastEraseWrapped = state.lastFrame.length > 0 && rows > state.lastFrame.length;
    prefix = eraseLines(rows);
  }
  if (m && rest === '') {
    // log.clear() before static output.
    state.expectStatic = true;
    state.lastFrame = [];
    return prefix;
  }
  if (rest.includes(CLEAR_SCREEN) || rest.includes('\x1b[?1049')) {
    state.lastFrame = [];
    state.expectStatic = false;
    return prefix + rest;
  }
  const printable = stripAnsi(rest);
  if (!m && !printable.includes('\n') && printable.trim() === '') {
    // Cursor hide/show, bell, OSC title, mode switches… not a frame.
    return rest;
  }
  if (!m && state.expectStatic) {
    // Static (transcript) output: it scrolls away, never erased.
    state.expectStatic = false;
    return rest;
  }
  state.expectStatic = false;
  const body = rest.replace(/\n$/, '');
  state.lastFrame = body.split('\n');
  // Ink ends every frame with "\n"; keep the cursor on the frame's last row instead.
  return prefix + body;
}

/**
 * Compose a full-screen repaint: the last transcript lines that fit above the
 * current frame, so that the frame ends on the last screen row. Overwriting the
 * screen rows in place leaves nothing behind in the terminal's scrollback and
 * removes the blank rows that reflow leaves at the end of the buffer (VTE keeps
 * the screen anchored to the end of its buffer, so those rows would otherwise
 * push the frame off the top after a few resizes).
 */
export function composeRepaint(tail: string[], frame: string[], rows: number, columns: number, reflow = true): string {
  const cols = Math.max(1, columns);
  const rowsOf = (line: string) => (reflow ? Math.max(1, Math.ceil(stringWidth(line) / cols)) : 1);
  const frameRows = physicalRows(frame, cols, reflow);
  const available = Math.max(0, rows - frameRows);
  const picked: string[] = [];
  let used = 0;
  for (let i = tail.length - 1; i >= 0; i--) {
    const r = rowsOf(tail[i]);
    if (used + r > available) break;
    picked.unshift(tail[i]);
    used += r;
  }
  // Never use ED 2 (`ESC[2J`): VTE and tmux first push the visible screen into the
  // scrollback, which duplicates the transcript on every repaint. Clearing and
  // rewriting each row with absolute positioning overwrites the screen in place.
  let out = '';
  for (let r = 1; r <= rows; r++) out += `\x1b[${r};1H\x1b[K`;
  let row = 1;
  const lines = [...picked, ...frame];
  for (const line of lines) {
    if (row > rows) break;
    out += `\x1b[${row};1H${line}`;
    row += rowsOf(line);
  }
  return out;
}

export interface FrameWriter {
  /** Clear the live frame and defer renderer writes while a child owns the TTY. */
  /** Hand the terminal over; `banner` replaces the default authentication line. */
  suspend: (fullscreen: boolean, banner?: string) => () => void;
  restore: () => void;
  reset: () => void;
  /** Repaint the visible screen with the transcript tail + the current frame. */
  repaint: (tail: string[], rows: number) => void;
  /**
   * True when the previous frame had wrapped when it was last erased: the
   * terminal buffer then keeps blank rows after the frame and a repaint is
   * needed to anchor the frame back to the bottom of the screen.
   */
  needsRepaint: () => boolean;
  /** Write transcript text that must not be tracked as a frame. */
  writeStatic: (text: string) => void;
}

export function installFrameWriter(stdout: NodeJS.WriteStream, options: { reflow?: boolean; syncOutput?: boolean } = {}): FrameWriter {
  const original = stdout.write.bind(stdout);
  const state: FrameWriterState = { lastFrame: [], expectStatic: false };
  const reflow = options.reflow ?? true;
  const sync = options.syncOutput ?? true;
  let deferred: Array<[any, any[]]> | null = null;
  (stdout as any).write = (chunk: any, ...rest: any[]) => {
    if (deferred) {
      // Keep stream callbacks moving; replay text only when the child has exited.
      deferred.push([chunk, []]);
      const callback = rest.find((value) => typeof value === 'function');
      if (callback) queueMicrotask(callback);
      return true;
    }
    if (typeof chunk !== 'string') return original(chunk, ...rest);
    const before = { frame: state.lastFrame.length, expectStatic: state.expectStatic };
    const out = transformChunk(chunk, state, stdout.columns || 80, reflow);
    if (DEBUG_FILE) {
      const m = chunk.match(ERASE_RE);
      const inkCount = m ? (m[0].match(/\x1b\[2K/g) ?? []).length : 0;
      const om = out.match(/^\x1b\[G(?:\x1b\[K(?:\x1b\[1A)?)+/);
      const ourCount = om ? (om[0].match(/\x1b\[K/g) ?? []).length : 0;
      debug(`${Date.now()} cols=${stdout.columns} rows=${stdout.rows} inkErase=${inkCount} ourErase=${ourCount} prevFrame=${before.frame} expectStatic=${before.expectStatic} newFrame=${state.lastFrame.length} widths=[${state.lastFrame.map((l) => stringWidth(l)).join(',')}] len=${chunk.length} head=${JSON.stringify(stripAnsi(chunk).slice(0, 40))}`);
    }
    if (out.length === 0) return original(out, ...rest);
    return original(sync ? `\x1b[?2026h${out}\x1b[?2026l` : out, ...rest);
  };
  const emit = (text: string) => { if (text.length) original(sync ? `\x1b[?2026h${text}\x1b[?2026l` : text); };
  return {
    suspend: (fullscreen, banner = 'Authentication in the terminal · Ctrl+C to cancel\r\n') => {
      if (deferred) throw new Error('The terminal is already in use.');
      const frame = [...state.lastFrame];
      const expectStatic = state.expectStatic;
      emit(eraseLines(physicalRows(frame, stdout.columns || 80, reflow)));
      deferred = [];
      emit('\x1b[?2004l\x1b[?1000l\x1b[?1006l\x1b[?25h' + (fullscreen ? '\x1b[?1049l' : '') + banner);
      let resumed = false;
      return () => {
        if (resumed) return;
        resumed = true;
        const pending = deferred!;
        deferred = null;
        emit('\r\n' + (fullscreen ? '\x1b[?1049h' : '') + '\x1b[?2004h\x1b[?25l' + (fullscreen && process.env.FULLER_DISABLE_MOUSE !== '1' ? '\x1b[?1000h\x1b[?1006h' : ''));
        state.lastFrame = frame;
        state.expectStatic = expectStatic;
        emit(frame.join('\n'));
        for (const [chunk, rest] of pending) (stdout as any).write(chunk, ...rest);
      };
    },
    restore: () => { (stdout as any).write = original; },
    reset: () => { state.lastFrame = []; state.expectStatic = false; },
    needsRepaint: () => !!state.lastEraseWrapped,
    repaint: (tail, rows) => {
      state.lastEraseWrapped = false;
      if (state.lastFrame.length === 0) return;
      const out = composeRepaint(tail, state.lastFrame, rows, stdout.columns || 80, reflow);
      debug(`${Date.now()} REPAINT rows=${rows} cols=${stdout.columns} tail=${tail.length} frame=${state.lastFrame.length}`);
      emit(out);
      state.expectStatic = false;
    },
    writeStatic: (text) => {
      if (deferred) { deferred.push([text, []]); return; }
      state.expectStatic = false;
      emit(text);
    },
  };
}
