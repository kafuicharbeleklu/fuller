import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CONFIG_DIR_NAME } from '../branding.js';
import { parseFrontmatter } from '../skills/loader.js';

export interface SubagentDefinition {
  name: string;
  description: string;
  /** Tool names the subagent may use (empty = all built-in tools). */
  tools: string[];
  model?: string;
  maxTurns: number;
  /** Extra system instructions. */
  prompt: string;
  scope: 'built-in' | 'project' | 'user' | 'claude-project' | 'claude-user';
  file?: string;
}

const READ_ONLY = ['read_file', 'list_directory', 'search_files', 'glob', 'web_fetch'];

export const BUILT_IN_SUBAGENTS: SubagentDefinition[] = [
  {
    name: 'general-purpose',
    description: 'General agent for multi-step tasks: research, code changes, verification. Has every built-in tool.',
    tools: [],
    maxTurns: 40,
    prompt: 'You are a subagent working on a delegated task. Work autonomously, keep your final answer factual and complete: what you found, what you changed (files, commands), and anything left open.',
    scope: 'built-in',
  },
  {
    name: 'Explore',
    description: 'Fast read-only agent for exploring the codebase: finds files, reads code, answers questions without modifying anything.',
    tools: READ_ONLY,
    maxTurns: 25,
    prompt: 'You are a read-only exploration subagent. Locate the relevant files and code, quote paths with line numbers, and answer precisely. Never modify files.',
    scope: 'built-in',
  },
];

function readDefinition(file: string, scope: SubagentDefinition['scope']): SubagentDefinition | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(text);
  const name = (typeof meta.name === 'string' && meta.name.trim()) || path.basename(file, '.md');
  const tools = Array.isArray(meta.tools) ? meta.tools : typeof meta.tools === 'string' ? meta.tools.split(',').map((t) => t.trim()).filter(Boolean) : [];
  return {
    name: name.replace(/\s+/g, '-'),
    description: typeof meta.description === 'string' ? meta.description : body.split('\n').find((l) => l.trim())?.slice(0, 120) ?? '',
    tools: tools.map((t) => normalizeToolName(String(t))),
    model: typeof meta.model === 'string' ? meta.model : undefined,
    maxTurns: typeof meta.maxturns === 'string' ? parseInt(meta.maxturns, 10) || 40 : 40,
    prompt: body.trim(),
    scope,
    file,
  };
}

/** Accept Claude Code tool names (Bash, Read, Edit…) as well as Fuller's. */
export function normalizeToolName(name: string): string {
  const map: Record<string, string> = {
    bash: 'execute_bash', read: 'read_file', write: 'write_file', edit: 'edit_file', multiedit: 'edit_file',
    ls: 'list_directory', grep: 'search_files', glob: 'glob', webfetch: 'web_fetch', todowrite: 'todo_write', skill: 'skill',
  };
  return map[name.toLowerCase()] ?? name;
}

export function loadSubagents(workspaceDir: string, homeDir = os.homedir()): SubagentDefinition[] {
  const sources: Array<[string, SubagentDefinition['scope']]> = [
    [path.join(workspaceDir, CONFIG_DIR_NAME, 'agents'), 'project'],
    [path.join(homeDir, CONFIG_DIR_NAME, 'agents'), 'user'],
    [path.join(workspaceDir, '.claude', 'agents'), 'claude-project'],
    [path.join(homeDir, '.claude', 'agents'), 'claude-user'],
  ];
  const byName = new Map<string, SubagentDefinition>();
  for (const [dir, scope] of sources) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { continue; }
    for (const f of entries) {
      const def = readDefinition(path.join(dir, f), scope);
      if (def && !byName.has(def.name)) byName.set(def.name, def);
    }
  }
  for (const b of BUILT_IN_SUBAGENTS) if (!byName.has(b.name)) byName.set(b.name, b);
  return [...byName.values()];
}

export function subagentsForPrompt(defs: SubagentDefinition[]): string {
  return defs.map((d) => `- ${d.name}: ${d.description}${d.tools.length ? ` (tools: ${d.tools.join(', ')})` : ''}`).join('\n');
}
