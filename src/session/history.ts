import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CONFIG_DIR_NAME } from '../branding.js';

const HISTORY_FILE = path.join(os.homedir(), CONFIG_DIR_NAME, 'history.jsonl');

export interface HistoryEntry {
  ts: number;
  cwd: string;
  text: string;
}

export function loadPromptHistory(cwd: string, limit = Infinity, scope: 'project' | 'all' = 'project'): string[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const lines = fs.readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean);
    const entries: HistoryEntry[] = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as HistoryEntry;
        if (e && typeof e.text === 'string') entries.push(e);
      } catch {}
    }
    const project = entries.filter((e) => e.cwd === cwd);
    const chosen = scope === 'all' ? entries : project;
    const out: string[] = [];
    for (const e of chosen) {
      if (out[out.length - 1] !== e.text) out.push(e.text);
    }
    return out.slice(-limit);
  } catch {
    return [];
  }
}

/** When every prompt was sent (all projects), for /stats. */
export function loadPromptTimestamps(): number[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const out: number[] = [];
    for (const line of fs.readFileSync(HISTORY_FILE, 'utf8').split('\n')) {
      if (!line) continue;
      try { const e = JSON.parse(line) as HistoryEntry; if (typeof e.ts === 'number') out.push(e.ts); } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

/** Latest time each prompt was sent, for the ages in ctrl+r ("11m ago"). */
export function loadPromptTimes(): Map<string, number> {
  const times = new Map<string, number>();
  try {
    if (!fs.existsSync(HISTORY_FILE)) return times;
    for (const line of fs.readFileSync(HISTORY_FILE, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const e = JSON.parse(line) as HistoryEntry;
        if (e && typeof e.text === 'string' && typeof e.ts === 'number') times.set(e.text, Math.max(e.ts, times.get(e.text) ?? 0));
      } catch {}
    }
  } catch {}
  return times;
}

export function appendPromptHistory(cwd: string, text: string): void {
  try {
    if (!text.trim() || text.length > 10_000) return;
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    fs.appendFileSync(HISTORY_FILE, JSON.stringify({ ts: Date.now(), cwd, text } satisfies HistoryEntry) + '\n', 'utf8');
  } catch {}
}
