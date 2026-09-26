import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG_DIR_NAME } from '../branding.js';
import type { McpServerEntry } from './config.js';

/**
 * Claude Code asks before starting a project's MCP servers ("New MCP server found in this
 * project"). The answers live in ~/.fuller, per project: a repository cannot ship its own approval.
 * User servers (~/.fuller/mcp.json) are the user's own and never asked about.
 */
export interface McpApproval {
  enabled: string[];
  disabled: string[];
  /** "Use this and all future MCP servers in this project". */
  all?: boolean;
}

type Store = Record<string, McpApproval>;

export function approvalFile(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME, 'mcp-approvals.json');
}

function projectKey(workspaceDir: string): string {
  try { return fs.realpathSync(workspaceDir); } catch { return path.resolve(workspaceDir); }
}

function readStore(): Store {
  try {
    const data = JSON.parse(fs.readFileSync(approvalFile(), 'utf8'));
    return data && typeof data === 'object' ? data as Store : {};
  } catch {
    return {};
  }
}

export function mcpApproval(workspaceDir: string): McpApproval {
  const entry = readStore()[projectKey(workspaceDir)];
  return {
    enabled: Array.isArray(entry?.enabled) ? entry.enabled : [],
    disabled: Array.isArray(entry?.disabled) ? entry.disabled : [],
    all: entry?.all === true,
  };
}

/** Merge new answers into the project's approvals. */
export function saveMcpApproval(workspaceDir: string, answer: McpApproval): void {
  const store = readStore();
  const key = projectKey(workspaceDir);
  const current = mcpApproval(workspaceDir);
  const enabled = new Set([...current.enabled.filter((n) => !answer.disabled.includes(n)), ...answer.enabled]);
  const disabled = new Set([...current.disabled.filter((n) => !answer.enabled.includes(n)), ...answer.disabled]);
  store[key] = { enabled: [...enabled], disabled: [...disabled], ...(answer.all || current.all ? { all: true } : {}) };
  fs.mkdirSync(path.dirname(approvalFile()), { recursive: true });
  fs.writeFileSync(approvalFile(), `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

/** Whether a server may start: the user's own, or a project server the user enabled. */
export function isApproved(entry: McpServerEntry, approval: McpApproval): boolean {
  // /mcp → Disable turns any server off for this project, the user's own included.
  if (approval.disabled.includes(entry.name)) return false;
  if (entry.scope === 'user') return true;
  return approval.all === true || approval.enabled.includes(entry.name);
}

/** Project servers not answered yet: the ones to ask about. */
export function pendingServers(entries: McpServerEntry[], approval: McpApproval): McpServerEntry[] {
  if (approval.all) return [];
  return entries.filter((e) => e.scope === 'project' && !approval.enabled.includes(e.name) && !approval.disabled.includes(e.name));
}
