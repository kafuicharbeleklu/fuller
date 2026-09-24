import fs from 'node:fs';
import path from 'node:path';
import { userConfigDir } from '../config.js';
import type { KeyEvent } from './useRawInput.js';

export type KeyAction = 'transcript' | 'diff' | 'externalEditor' | 'tasks' | 'redraw' | 'historySearch' | 'undo' | 'cycleMode';
export type Keybindings = Record<string, KeyAction | null>;
const ACTIONS = new Set<KeyAction>(['transcript', 'diff', 'externalEditor', 'tasks', 'redraw', 'historySearch', 'undo', 'cycleMode']);

/** ~/.fuller/keybindings.json: {"bindings":{"ctrl+g":"externalEditor"}} */
export function loadKeybindings(): Keybindings {
  try {
    const file = path.join(userConfigDir(), 'keybindings.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const result: Keybindings = {};
    for (const [key, action] of Object.entries(data.bindings ?? {})) {
      if (action === null || (typeof action === 'string' && ACTIONS.has(action as KeyAction))) result[key.toLowerCase()] = action as KeyAction | null;
    }
    return result;
  } catch { return {}; }
}

export function keyString(event: KeyEvent): string {
  const modifiers = [event.ctrl && 'ctrl', event.alt && 'alt', event.shift && 'shift'].filter(Boolean);
  const name = event.name === 'char' ? event.text.toLowerCase() : event.name;
  return [...modifiers, name].join('+');
}
