import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { userConfigDir } from '../config.js';
import type { KeyEvent } from './useRawInput.js';

/** Actions the prompt can run from a user binding. */
export type KeyAction =
  | 'transcript' | 'diff' | 'externalEditor' | 'tasks' | 'redraw' | 'historySearch' | 'undo' | 'cycleMode'
  | 'stash' | 'imagePaste' | 'modelPicker' | 'sendNow' | 'killAgents' | 'cycleDiffBase';
/** Key string ("ctrl+g", or a chord "ctrl+x ctrl+e") → action; null unbinds the default. */
export type Keybindings = Record<string, KeyAction | null>;

/**
 * Claude Code's action names (docs, keybindings) for what Fuller can do from the prompt. Its file
 * format, `{"bindings": [{"context": "Chat", "bindings": {"ctrl+e": "chat:externalEditor"}}]}`,
 * is read as is, so an existing ~/.claude/keybindings.json works in Fuller for these actions.
 */
const CLAUDE_ACTIONS: Record<string, KeyAction> = {
  'app:toggleTranscript': 'transcript',
  'app:toggleReplTab': 'diff',
  'app:toggleTodos': 'tasks',
  'app:redraw': 'redraw',
  'app:cycleDiffBase': 'cycleDiffBase',
  'history:search': 'historySearch',
  'chat:externalEditor': 'externalEditor',
  'chat:undo': 'undo',
  'chat:cycleMode': 'cycleMode',
  'chat:stash': 'stash',
  'chat:imagePaste': 'imagePaste',
  'chat:modelPicker': 'modelPicker',
  'chat:sendNow': 'sendNow',
  'chat:killAgents': 'killAgents',
};
/** Fuller's own short names (the older format, still read). */
const SHORT_ACTIONS = new Set<KeyAction>(Object.values(CLAUDE_ACTIONS));
/** Contexts whose bindings reach the prompt. The others (Transcript, DiffDialog, Settings…) are not rebindable in Fuller yet. */
const PROMPT_CONTEXTS = new Set(['global', 'chat', 'history', 'diffpanel']);

export interface KeybindingsLoad {
  bindings: Keybindings;
  /** Unknown actions or contexts, ignored (the default key stays, as Claude Code does since 2.1.246). */
  warnings: string[];
  file: string | null;
}

/** A key as the file writes it, normalised: "Ctrl+X  Ctrl+E" → "ctrl+x ctrl+e", "meta+p" → "alt+p". */
export function normalizeKey(key: string): string {
  return key.trim().toLowerCase().split(/\s+/).map((part) => part.replace(/^meta\+|(?<=\+)meta\+/g, (m) => m.replace('meta', 'alt'))).join(' ');
}

function actionOf(value: unknown): KeyAction | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  if (CLAUDE_ACTIONS[value]) return CLAUDE_ACTIONS[value];
  if (SHORT_ACTIONS.has(value as KeyAction)) return value as KeyAction;
  return undefined;
}

/** Parse either format; the result never throws. */
export function parseKeybindings(data: unknown): { bindings: Keybindings; warnings: string[] } {
  const bindings: Keybindings = {};
  const warnings: string[] = [];
  const add = (key: string, value: unknown) => {
    const action = actionOf(value);
    if (action === undefined) { warnings.push(`Unknown action ${JSON.stringify(value)} for ${key} (ignored)`); return; }
    bindings[normalizeKey(key)] = action;
  };
  const raw = (data as { bindings?: unknown } | null)?.bindings;
  if (Array.isArray(raw)) {
    for (const block of raw) {
      const context = String((block as { context?: unknown })?.context ?? '').toLowerCase();
      const entries = (block as { bindings?: unknown })?.bindings;
      if (!PROMPT_CONTEXTS.has(context)) { warnings.push(`Context "${(block as { context?: unknown })?.context}" is not supported by Fuller (ignored)`); continue; }
      if (entries && typeof entries === 'object') for (const [key, value] of Object.entries(entries)) add(key, value);
    }
  } else if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) add(key, value);
  }
  return { bindings, warnings };
}

/** ~/.fuller/keybindings.json, else ~/.claude/keybindings.json (Fuller reads .claude for commands and skills too). */
export function keybindingsFile(): string | null {
  const candidates = [path.join(userConfigDir(), 'keybindings.json'), path.join(os.homedir(), '.claude', 'keybindings.json')];
  return candidates.find((file) => { try { return fs.statSync(file).isFile(); } catch { return false; } }) ?? null;
}

export function loadKeybindingsFull(): KeybindingsLoad {
  const file = keybindingsFile();
  if (!file) return { bindings: {}, warnings: [], file: null };
  try {
    return { ...parseKeybindings(JSON.parse(fs.readFileSync(file, 'utf8'))), file };
  } catch (err: any) {
    return { bindings: {}, warnings: [`${file}: ${err?.message ?? err}`], file };
  }
}

export function loadKeybindings(): Keybindings {
  return loadKeybindingsFull().bindings;
}

/** Changes to the file apply without a restart, as in Claude Code: reloaded when its mtime changes. */
let cache: { file: string | null; mtime: number; bindings: Keybindings } | null = null;
export function currentKeybindings(): Keybindings {
  const file = keybindingsFile();
  let mtime = 0;
  try { mtime = file ? fs.statSync(file).mtimeMs : 0; } catch {}
  if (!cache || cache.file !== file || cache.mtime !== mtime) cache = { file, mtime, bindings: loadKeybindings() };
  return cache.bindings;
}

/** Keys that start a bound chord ("ctrl+k" for "ctrl+k ctrl+s"). */
export function chordPrefixes(bindings: Keybindings): Set<string> {
  return new Set(Object.keys(bindings).filter((key) => key.includes(' ')).map((key) => key.split(' ')[0]));
}

export function keyString(event: KeyEvent): string {
  const modifiers = [event.ctrl && 'ctrl', event.alt && 'alt', event.shift && 'shift'].filter(Boolean);
  const name = event.name === 'char' ? event.text.toLowerCase() : event.name;
  return [...modifiers, name].join('+');
}
