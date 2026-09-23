import { useEffect, useRef } from 'react';
import { useStdin } from 'ink';

export type KeyName =
  | 'char' | 'return' | 'tab' | 'escape' | 'backspace' | 'delete'
  | 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'pageup' | 'pagedown'
  | 'paste' | 'unknown';

export interface KeyEvent {
  name: KeyName;
  /** Printable text for `char`, pasted text for `paste`. */
  text: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  raw: string;
}

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

const CSI_NAMES: Record<string, KeyName> = {
  A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end', Z: 'tab',
  '1~': 'home', '7~': 'home', '4~': 'end', '8~': 'end', '3~': 'delete', '5~': 'pageup', '6~': 'pagedown', '2~': 'unknown',
};

function modifiers(param: number): { shift: boolean; alt: boolean; ctrl: boolean } {
  const m = Math.max(0, param - 1);
  return { shift: !!(m & 1), alt: !!(m & 2), ctrl: !!(m & 4) };
}

/** Parse a raw stdin chunk into key events (handles sequences concatenated in one chunk). */
export function parseKeys(data: string): KeyEvent[] {
  const events: KeyEvent[] = [];
  let i = 0;
  const push = (e: Partial<KeyEvent> & { name: KeyName; raw: string }) =>
    events.push({ text: '', ctrl: false, alt: false, shift: false, ...e });

  while (i < data.length) {
    const ch = data[i];
    if (ch === '\x1b') {
      const rest = data.slice(i);
      if (rest.startsWith(PASTE_START)) {
        const end = rest.indexOf(PASTE_END);
        const body = end === -1 ? rest.slice(PASTE_START.length) : rest.slice(PASTE_START.length, end);
        push({ name: 'paste', text: body, raw: end === -1 ? rest : rest.slice(0, end + PASTE_END.length) });
        i += end === -1 ? rest.length : end + PASTE_END.length;
        continue;
      }
      const csi = rest.match(/^\x1b\[([\d;?]*)([A-Za-z~@^$])/);
      if (csi) {
        const params = csi[1];
        const final = csi[2];
        const raw = csi[0];
        const nums = params.split(';').map((n) => parseInt(n, 10));
        if (final === 'u' && nums.length >= 1) {
          const code = nums[0];
          const mods = modifiers(nums[1] ?? 1);
          if (code === 13) push({ name: 'return', raw, ...mods });
          else if (code === 27) push({ name: 'escape', raw, ...mods });
          else if (code === 9) push({ name: 'tab', raw, ...mods });
          else if (code === 127 || code === 8) push({ name: 'backspace', raw, ...mods });
          else push({ name: 'char', text: String.fromCodePoint(code), raw, ...mods });
        } else if (final === '~' && nums[0] === 27 && nums.length === 3) {
          const mods = modifiers(nums[1]);
          const code = nums[2];
          if (code === 13) push({ name: 'return', raw, ...mods });
          else push({ name: 'char', text: String.fromCodePoint(code), raw, ...mods });
        } else if (final === '~') {
          const key = `${nums[0]}~`;
          const mods = modifiers(nums[1] ?? 1);
          push({ name: CSI_NAMES[key] ?? 'unknown', raw, ...mods });
        } else if (final === 'Z') {
          push({ name: 'tab', shift: true, raw });
        } else {
          const mods = modifiers(nums.length >= 2 ? nums[1] : 1);
          push({ name: CSI_NAMES[final] ?? 'unknown', raw, ...mods });
        }
        i += raw.length;
        continue;
      }
      const ss3 = rest.match(/^\x1bO([A-Za-z])/);
      if (ss3) {
        push({ name: CSI_NAMES[ss3[1]] ?? 'unknown', raw: ss3[0] });
        i += ss3[0].length;
        continue;
      }
      if (rest.length >= 2 && rest[1] !== '\x1b') {
        const next = rest[1];
        if (next === '\r' || next === '\n') push({ name: 'return', alt: true, raw: rest.slice(0, 2) });
        else if (next === '\x7f' || next === '\b') push({ name: 'backspace', alt: true, raw: rest.slice(0, 2) });
        else if (next === '\t') push({ name: 'tab', alt: true, raw: rest.slice(0, 2) });
        else if (next < ' ') push({ name: 'char', text: String.fromCharCode(next.charCodeAt(0) + 96), ctrl: true, alt: true, raw: rest.slice(0, 2) });
        else push({ name: 'char', text: next, alt: true, raw: rest.slice(0, 2) });
        i += 2;
        continue;
      }
      push({ name: 'escape', raw: '\x1b' });
      i += 1;
      continue;
    }
    if (ch === '\r') { push({ name: 'return', raw: ch }); i++; continue; }
    if (ch === '\n') { push({ name: 'return', ctrl: true, raw: ch }); i++; continue; }
    if (ch === '\t') { push({ name: 'tab', raw: ch }); i++; continue; }
    if (ch === '\x7f' || ch === '\b') { push({ name: 'backspace', raw: ch }); i++; continue; }
    const code = ch.charCodeAt(0);
    if (code < 32) {
      const letter = code === 0 ? ' ' : code === 0x1f ? '_' : code === 0x1e ? '^' : code === 0x1c ? '\\' : code === 0x1d ? ']' : String.fromCharCode(code + 96);
      push({ name: 'char', text: letter, ctrl: true, raw: ch });
      i++;
      continue;
    }
    let j = i;
    while (j < data.length && data[j] !== '\x1b' && data.charCodeAt(j) >= 32 && data[j] !== '\x7f') j++;
    push({ name: 'char', text: data.slice(i, j), raw: data.slice(i, j) });
    i = j;
  }
  return events;
}

/**
 * Subscribe to raw stdin chunks (bypasses Ink's key normalisation so that
 * Home/End, Alt/Ctrl combinations and bracketed paste can be handled).
 */
export function useRawInput(handler: (event: KeyEvent) => void, options: { isActive?: boolean } = {}) {
  const { internal_eventEmitter, setRawMode, isRawModeSupported } = useStdin() as any;
  const isActive = options.isActive !== false;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const pasteBuffer = useRef<string | null>(null);

  useEffect(() => {
    if (!isActive || !isRawModeSupported) return;
    setRawMode(true);
    return () => setRawMode(false);
  }, [isActive, isRawModeSupported, setRawMode]);

  useEffect(() => {
    if (!isActive || !internal_eventEmitter) return;
    const onData = (chunk: string | Buffer) => {
      let data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (pasteBuffer.current !== null) {
        const end = data.indexOf(PASTE_END);
        if (end === -1) {
          pasteBuffer.current += data;
          return;
        }
        const text = pasteBuffer.current + data.slice(0, end);
        pasteBuffer.current = null;
        handlerRef.current({ name: 'paste', text, ctrl: false, alt: false, shift: false, raw: text });
        data = data.slice(end + PASTE_END.length);
        if (!data) return;
      }
      const startIdx = data.indexOf(PASTE_START);
      if (startIdx !== -1 && data.indexOf(PASTE_END, startIdx) === -1) {
        const before = data.slice(0, startIdx);
        pasteBuffer.current = data.slice(startIdx + PASTE_START.length);
        data = before;
        if (!data) return;
      }
      for (const ev of parseKeys(data)) handlerRef.current(ev);
    };
    internal_eventEmitter.on('input', onData);
    return () => {
      internal_eventEmitter.removeListener('input', onData);
    };
  }, [isActive, internal_eventEmitter]);
}
