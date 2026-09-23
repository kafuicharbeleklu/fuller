import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Content } from '@google/genai';
import { CONFIG_DIR_NAME } from '../branding.js';
import type { ChatMessage, TodoItem } from '../agent/types.js';

export interface SessionMeta {
  id: string;
  title?: string;
  workspaceDir: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  tokenCount: number;
  gitBranch?: string;
}

export interface SessionData {
  meta: SessionMeta;
  messages: ChatMessage[];
  /** Gemini chat history, used to really restore the model context. */
  history?: Content[];
  todos?: TodoItem[];
}

export function encodeWorkspace(workspaceDir: string): string {
  return path.resolve(workspaceDir).replace(/[\\/:]/g, '-').replace(/^-+/, '-');
}

export function sessionsDir(workspaceDir: string): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME, 'projects', encodeWorkspace(workspaceDir));
}

export function ensureSessionsDir(workspaceDir: string): string {
  const dir = sessionsDir(workspaceDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function generateSessionId(): string {
  const d = new Date();
  const stamp = d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sessionFile(workspaceDir: string, id: string): string {
  return path.join(sessionsDir(workspaceDir), `${id}.json`);
}

export function saveSessionSync(data: SessionData): void {
  const dir = ensureSessionsDir(data.meta.workspaceDir);
  const file = path.join(dir, `${data.meta.id}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, file);
}

let pending: Promise<void> = Promise.resolve();

/** Serialized async save (never overlaps, always writes the latest snapshot). */
export function saveSession(data: SessionData): Promise<void> {
  pending = pending.then(async () => {
    const dir = ensureSessionsDir(data.meta.workspaceDir);
    const file = path.join(dir, `${data.meta.id}.json`);
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fs.promises.rename(tmp, file);
  }).catch(() => {});
  return pending;
}

export function flushSessionSaves(): Promise<void> {
  return pending;
}

export function loadSession(workspaceDir: string, id: string): SessionData | null {
  try {
    const file = sessionFile(workspaceDir, id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SessionData;
  } catch {
    return null;
  }
}

export function listSessions(workspaceDir: string): SessionMeta[] {
  const dir = sessionsDir(workspaceDir);
  if (!fs.existsSync(dir)) return [];
  const sessions: SessionMeta[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as SessionData;
      if (data?.meta?.id && data.meta.messageCount > 0) sessions.push(data.meta);
    } catch {}
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getLatestSession(workspaceDir: string): SessionData | null {
  const sessions = listSessions(workspaceDir);
  return sessions.length ? loadSession(workspaceDir, sessions[0].id) : null;
}

export function deleteSession(workspaceDir: string, id: string): void {
  try {
    fs.unlinkSync(sessionFile(workspaceDir, id));
  } catch {}
}

export function sessionTitleFrom(messages: ChatMessage[]): string | undefined {
  const first = messages.find((m) => m.role === 'user' && m.kind !== 'command');
  if (!first) return undefined;
  const line = first.content.split('\n')[0].trim();
  return line.length > 60 ? line.slice(0, 57) + '…' : line;
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
