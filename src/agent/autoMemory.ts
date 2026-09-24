import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG_DIR_NAME } from '../branding.js';
import { sessionsDir } from '../session/store.js';

/**
 * Learned memory (Claude Code's auto memory): notes the agent saves with the
 * `memory` tool when the user corrects it, states a preference or reveals a
 * fact the code does not show. They live in plain Markdown files the user can
 * edit (/memory) and come back in the system prompt of every session:
 *   project: ~/.fuller/projects/<project>/memory/MEMORY.md
 *   user:    ~/.fuller/memory/MEMORY.md
 */

export type MemoryType = 'preference' | 'feedback' | 'project' | 'reference';
export type MemoryScope = 'project' | 'user';
export const MEMORY_TYPES: MemoryType[] = ['preference', 'feedback', 'project', 'reference'];

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  text: string;
  date: string;
}

/** Past this, the agent must merge or remove notes before adding more. */
export const MAX_ENTRIES_PER_FILE = 80;
const MAX_NOTE_CHARS = 600;
const ENTRY = /^- \[(preference|feedback|project|reference)\] (.+?) <!-- id:([a-z0-9]+) date:(\d{4}-\d{2}-\d{2}) -->$/;
const HEADER = '# Learned memory\n\nNotes Fuller saved while working with you. Edit or delete lines freely.\n\n';

export function memoryFile(scope: MemoryScope, workspaceDir: string): string {
  return scope === 'user'
    ? path.join(os.homedir(), CONFIG_DIR_NAME, 'memory', 'MEMORY.md')
    : path.join(sessionsDir(workspaceDir), 'memory', 'MEMORY.md');
}

function readEntries(scope: MemoryScope, workspaceDir: string): MemoryEntry[] {
  try {
    const text = fs.readFileSync(memoryFile(scope, workspaceDir), 'utf8');
    return text.split('\n').flatMap((line) => {
      const m = line.trim().match(ENTRY);
      return m ? [{ type: m[1] as MemoryType, text: m[2], id: m[3], date: m[4], scope }] : [];
    });
  } catch {
    return [];
  }
}

function writeEntries(scope: MemoryScope, workspaceDir: string, entries: MemoryEntry[]): void {
  const file = memoryFile(scope, workspaceDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = entries.map((e) => `- [${e.type}] ${e.text} <!-- id:${e.id} date:${e.date} -->`).join('\n');
  fs.writeFileSync(file, HEADER + body + (body ? '\n' : ''), 'utf8');
}

export function loadMemories(workspaceDir: string): MemoryEntry[] {
  return [...readEntries('user', workspaceDir), ...readEntries('project', workspaceDir)];
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Tokens, keys and passwords never go into memory files. */
export function looksSecret(text: string): boolean {
  return /\b(sk-[a-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(text)
    || /\b(password|passwd|mot de passe|secret|token|api[_ -]?key)\b\s*[:=]\s*\S{6,}/i.test(text);
}

export function addMemory(workspaceDir: string, input: { text: string; type?: string; scope?: string }, now = new Date()): { entry?: MemoryEntry; error?: string; duplicate?: MemoryEntry } {
  const text = input.text.replace(/\s+/g, ' ').trim();
  if (!text) return { error: 'note is required.' };
  if (text.length > MAX_NOTE_CHARS) return { error: `A note is at most ${MAX_NOTE_CHARS} characters: keep one fact per note.` };
  if (text.includes('<!--') || text.includes('-->')) return { error: 'Notes cannot contain HTML comments.' };
  if (looksSecret(text)) return { error: 'This looks like a secret (key, token or password): secrets are never saved to memory.' };
  const type = (MEMORY_TYPES as string[]).includes(String(input.type)) ? input.type as MemoryType : 'project';
  const scope: MemoryScope = input.scope === 'user' ? 'user' : 'project';
  const entries = readEntries(scope, workspaceDir);
  const duplicate = entries.find((e) => normalize(e.text) === normalize(text));
  if (duplicate) return { duplicate };
  if (entries.length >= MAX_ENTRIES_PER_FILE) return { error: `The ${scope} memory is full (${MAX_ENTRIES_PER_FILE} notes): remove outdated notes or merge several into one first.` };
  const entry: MemoryEntry = { id: crypto.randomBytes(3).toString('hex'), type, scope, text, date: now.toISOString().slice(0, 10) };
  writeEntries(scope, workspaceDir, [...entries, entry]);
  return { entry };
}

export function removeMemory(workspaceDir: string, id: string): MemoryEntry | undefined {
  for (const scope of ['project', 'user'] as MemoryScope[]) {
    const entries = readEntries(scope, workspaceDir);
    const found = entries.find((e) => e.id === id);
    if (found) {
      writeEntries(scope, workspaceDir, entries.filter((e) => e.id !== id));
      return found;
    }
  }
  return undefined;
}

/** The system prompt section: how to use the memory, then the notes with their ids. */
export function memoryPrompt(entries: MemoryEntry[]): string {
  const lines = [
    '# Learned memory',
    'You keep notes across sessions with the memory tool. Save a note (action "add") when:',
    '- the user corrects you or tells you how they want things done (type feedback or preference) — include why when they say it;',
    '- you learn a project fact the code does not show: a convention, a command that works, a constraint, a decision (type project);',
    '- the user points you to an external resource: a dashboard, a ticket, documentation (type reference).',
    'Do not save what the code or git history already says, what only matters for the current task, or any secret. One fact per note, written so it is useful out of context. Use scope "user" for preferences that apply to every project.',
    'Remove a note (action "remove" with its id) when it turns out wrong or outdated. Notes reflect what was true when written: check before relying on one that names a file, function or flag.',
  ];
  if (entries.length) {
    lines.push('', 'Current notes:');
    for (const e of entries) lines.push(`- [${e.id}] (${e.scope} · ${e.type} · ${e.date}) ${e.text}`);
  } else {
    lines.push('', 'No notes yet.');
  }
  return lines.join('\n');
}
