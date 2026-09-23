import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CONFIG_DIR_NAME } from '../branding.js';

export interface McpStdioServer {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpHttpServer {
  type?: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServer | McpHttpServer;

export interface McpServerEntry {
  name: string;
  config: McpServerConfig;
  scope: 'project' | 'user';
  file: string;
}

function readServers(file: string, scope: McpServerEntry['scope']): McpServerEntry[] {
  try {
    if (!fs.existsSync(file)) return [];
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const servers = json?.mcpServers;
    if (!servers || typeof servers !== 'object') return [];
    return Object.entries(servers)
      .filter(([, v]) => v && typeof v === 'object' && (typeof (v as any).command === 'string' || typeof (v as any).url === 'string'))
      .map(([name, config]) => ({ name: name.replace(/[^\w-]/g, '_'), config: expandEnv(config as McpServerConfig), scope, file }));
  } catch {
    return [];
  }
}

/** Expand ${VAR} and ${VAR:-default} in strings (command, args, env, url, headers). */
export function expandEnv<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name: string, def?: string) => process.env[name] ?? def ?? '') as unknown as T;
  }
  if (Array.isArray(value)) return value.map(expandEnv) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = expandEnv(v);
    return out as T;
  }
  return value;
}

/** Project `.mcp.json` and `.fuller/mcp.json`, then user `~/.fuller/mcp.json`; the first definition of a name wins. */
export function loadMcpConfig(workspaceDir: string, homeDir = os.homedir()): McpServerEntry[] {
  const sources: Array<[string, McpServerEntry['scope']]> = [
    [path.join(workspaceDir, '.mcp.json'), 'project'],
    [path.join(workspaceDir, CONFIG_DIR_NAME, 'mcp.json'), 'project'],
    [path.join(homeDir, CONFIG_DIR_NAME, 'mcp.json'), 'user'],
  ];
  const byName = new Map<string, McpServerEntry>();
  for (const [file, scope] of sources) {
    for (const entry of readServers(file, scope)) if (!byName.has(entry.name)) byName.set(entry.name, entry);
  }
  return [...byName.values()];
}

export function isHttpServer(config: McpServerConfig): config is McpHttpServer {
  return typeof (config as McpHttpServer).url === 'string';
}
