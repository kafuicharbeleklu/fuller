import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CONFIG_DIR_NAME } from '../branding.js';

const HISTORY_FILE = path.join(os.homedir(), CONFIG_DIR_NAME, 'history.jsonl');
const MAX_ENTRIES = 1000;

export interface HistoryEntry {
  ts: number;
  cwd: string;
  text: string;
}

export function loadPromptHistory(cwd: string, limit = 500): string[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const lines = fs.readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean);
    const entries: HistoryEntry[] = [];
    for (const line of lines.slice(-MAX_ENTRIES)) {
      try {
        const e = JSON.parse(line) as HistoryEntry;
        if (e && typeof e.text === 'string') entries.push(e);
      } catch {}
    }
    const project = entries.filter((e) => e.cwd === cwd);
    const chosen = project.length > 0 ? project : entries;
    const out: string[] = [];
    for (const e of chosen) {
      if (out[out.length - 1] !== e.text) out.push(e.text);
    }
    return out.slice(-limit);
  } catch {
    return [];
  }
}

export function appendPromptHistory(cwd: string, text: string): void {
  try {
    if (!text.trim() || text.length > 10_000) return;
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    fs.appendFileSync(HISTORY_FILE, JSON.stringify({ ts: Date.now(), cwd, text } satisfies HistoryEntry) + '\n', 'utf8');
  } catch {}
}
