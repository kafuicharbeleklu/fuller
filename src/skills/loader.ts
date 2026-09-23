import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CONFIG_DIR_NAME } from '../branding.js';
import { executeBash } from '../tools/bash.js';
import { truncateMiddle } from '../tools/truncate.js';

export type SkillScope = 'project' | 'user' | 'claude-project' | 'claude-user';

export interface SkillDefinition {
  /** Slash name without the leading "/". */
  name: string;
  description: string;
  argumentHint?: string;
  allowedTools: string[];
  model?: string;
  /** Shown in the "/" menu and runnable by the user (default true). */
  userInvocable: boolean;
  /** Loadable by the model through the `skill` tool (default true). */
  modelInvocable: boolean;
  body: string;
  file: string;
  scope: SkillScope;
  kind: 'command' | 'skill';
}

export interface Frontmatter {
  meta: Record<string, string | string[] | boolean>;
  body: string;
}

function parseScalar(raw: string): string | string[] | boolean {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('[') && v.endsWith(']')) {
    return v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  return v.replace(/^["']|["']$/g, '');
}

/** Minimal YAML frontmatter: `key: value`, `key: [a, b]`, or a block of `- item` lines. */
export function parseFrontmatter(text: string): Frontmatter {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta: Frontmatter['meta'] = {};
  const lines = m[1].split(/\r?\n/);
  let currentKey: string | null = null;
  for (const line of lines) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && currentKey) {
      const existing = meta[currentKey];
      const arr = Array.isArray(existing) ? existing : [];
      arr.push(item[1].trim().replace(/^["']|["']$/g, ''));
      meta[currentKey] = arr;
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    currentKey = kv[1].toLowerCase();
    meta[currentKey] = kv[2].trim() === '' ? [] : parseScalar(kv[2]);
  }
  return { meta, body: text.slice(m[0].length) };
}

function toList(v: string | string[] | boolean | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function readSkillFile(file: string, fallbackName: string, scope: SkillScope, kind: SkillDefinition['kind']): SkillDefinition | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(text);
  const name = (typeof meta.name === 'string' && meta.name.trim()) || fallbackName;
  const firstLine = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) ?? '';
  return {
    name: name.replace(/^\//, '').replace(/\s+/g, '-'),
    description: typeof meta.description === 'string' ? meta.description : firstLine.slice(0, 80),
    argumentHint: typeof meta['argument-hint'] === 'string' ? meta['argument-hint'] : Array.isArray(meta['argument-hint']) ? `[${meta['argument-hint'].join(', ')}]` : undefined,
    allowedTools: toList(meta['allowed-tools']),
    model: typeof meta.model === 'string' ? meta.model : undefined,
    userInvocable: meta['user-invocable'] !== false,
    modelInvocable: meta['disable-model-invocation'] !== true,
    body: body.trim(),
    file,
    scope,
    kind,
  };
}

function listCommands(dir: string, scope: SkillScope): SkillDefinition[] {
  const out: SkillDefinition[] = [];
  const walk = (current: string, prefix: string[]) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) walk(full, [...prefix, e.name]);
      else if (e.isFile() && e.name.endsWith('.md')) {
        const base = e.name.slice(0, -3);
        const def = readSkillFile(full, [...prefix, base].join(':'), scope, 'command');
        if (def) out.push(def);
      }
    }
  };
  walk(dir, []);
  return out;
}

function listSkills(dir: string, scope: SkillScope): SkillDefinition[] {
  const out: SkillDefinition[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(dir, e.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const def = readSkillFile(file, e.name, scope, 'skill');
    if (def) out.push(def);
  }
  return out;
}

/**
 * Discover custom commands and skills. Precedence: project (.fuller) > user
 * (~/.fuller) > Claude Code compatible locations (.claude, ~/.claude).
 */
export function loadSkills(workspaceDir: string, homeDir = os.homedir()): SkillDefinition[] {
  const sources: Array<[string, SkillScope]> = [
    [path.join(workspaceDir, CONFIG_DIR_NAME), 'project'],
    [path.join(homeDir, CONFIG_DIR_NAME), 'user'],
    [path.join(workspaceDir, '.claude'), 'claude-project'],
    [path.join(homeDir, '.claude'), 'claude-user'],
  ];
  const byName = new Map<string, SkillDefinition>();
  for (const [root, scope] of sources) {
    for (const def of [...listSkills(path.join(root, 'skills'), scope), ...listCommands(path.join(root, 'commands'), scope)]) {
      if (!byName.has(def.name)) byName.set(def.name, def);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function splitArgs(args: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(args)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * Expand a skill body: `$ARGUMENTS`, `$1`…`$9`, and inline shell commands
 * written as !`command` (executed in the workspace, output inlined).
 */
export async function expandSkill(skill: SkillDefinition, args: string, cwd: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<string> {
  const positional = splitArgs(args);
  let text = skill.body
    .replace(/\$ARGUMENTS/g, args.trim())
    .replace(/\$(\d)/g, (_, n: string) => positional[Number(n) - 1] ?? '');
  const shell = /!`([^`\n]+)`/g;
  const commands = [...text.matchAll(shell)];
  for (const m of commands) {
    const res = await executeBash(m[1], cwd, { timeoutMs: options.timeoutMs ?? 30_000, signal: options.signal });
    const output = [res.stdout, res.stderr ? `[stderr]\n${res.stderr}` : ''].filter(Boolean).join('\n').trim() || '(no output)';
    text = text.replace(m[0], `\`\`\`\n$ ${m[1]}\n${truncateMiddle(output, 10_000)}\n\`\`\``);
  }
  return text.trim();
}

/** Prompt sent when the user runs a custom command: the instructions are inlined, so the model must not reload them. */
export function commandPrompt(skill: SkillDefinition, expanded: string): string {
  return `The user ran the custom command /${skill.name}. Its instructions are inlined below (do not call the skill tool for it).\n\n${expanded}`;
}

/** Lines for the system prompt. */
export function skillsForPrompt(skills: SkillDefinition[]): string {
  const visible = skills.filter((s) => s.modelInvocable);
  if (visible.length === 0) return '';
  return visible.map((s) => `- ${s.name}: ${s.description || '(no description)'}`).join('\n');
}
