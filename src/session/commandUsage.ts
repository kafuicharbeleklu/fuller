import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CONFIG_DIR_NAME } from '../branding.js';

/** How often and how recently each slash command was used, for the / menu order. */
export type CommandUsage = Record<string, { count: number; last: number }>;

const usageFile = () => path.join(os.homedir(), CONFIG_DIR_NAME, 'command-usage.json');
const HALF_LIFE_MS = 7 * 86_400_000;

export function loadCommandUsage(): CommandUsage {
  try {
    const data = JSON.parse(fs.readFileSync(usageFile(), 'utf8'));
    return data && typeof data === 'object' ? data as CommandUsage : {};
  } catch {
    return {};
  }
}

export function recordCommandUsage(name: string, now = Date.now()): void {
  try {
    const usage = loadCommandUsage();
    const entry = usage[name] ?? { count: 0, last: 0 };
    usage[name] = { count: entry.count + 1, last: now };
    fs.mkdirSync(path.dirname(usageFile()), { recursive: true });
    fs.writeFileSync(usageFile(), JSON.stringify(usage), 'utf8');
  } catch {}
}

/** Uses weighted by recency: a use counts half after a week, a quarter after two. */
export function usageScore(usage: CommandUsage, name: string, now = Date.now()): number {
  const entry = usage[name];
  if (!entry) return 0;
  return entry.count * Math.pow(0.5, Math.max(0, now - entry.last) / HALF_LIFE_MS);
}
