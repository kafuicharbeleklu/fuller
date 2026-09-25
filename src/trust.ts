import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG_DIR_NAME } from './branding.js';

/**
 * Workspace trust, as Claude Code asks "Accessing workspace… Yes, I trust this folder": until the
 * user trusts a folder, nothing of it is loaded, since a project can run code (hooks, MCP servers,
 * a status line command) or redirect the API with the user's key (.env, settings env).
 * Trusting a folder trusts its sub-folders.
 */
export function trustFile(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME, 'trusted-folders.json');
}

function real(dir: string): string {
  try { return fs.realpathSync(dir); } catch { return path.resolve(dir); }
}

export function trustedFolders(): string[] {
  try {
    const data = JSON.parse(fs.readFileSync(trustFile(), 'utf8'));
    return Array.isArray(data.folders) ? data.folders.filter((f: unknown): f is string => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

export function isTrusted(dir: string): boolean {
  const target = real(dir);
  return trustedFolders().some((folder) => {
    const rel = path.relative(folder, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

export function trustFolder(dir: string): void {
  const folder = real(dir);
  const folders = trustedFolders();
  if (folders.includes(folder)) return;
  fs.mkdirSync(path.dirname(trustFile()), { recursive: true });
  fs.writeFileSync(trustFile(), `${JSON.stringify({ folders: [...folders, folder] }, null, 2)}\n`, { mode: 0o600 });
}
