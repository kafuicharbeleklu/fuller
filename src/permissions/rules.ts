import path from 'node:path';
import type { PermissionMode, PermissionOption } from '../agent/types.js';
import type { Settings } from '../config.js';
import { classifyCommand, suggestPrefix, type RiskLevel } from './bashParser.js';

export interface PermissionRule {
  tool: string;
  spec?: string;
  raw: string;
}

export const TOOL_DISPLAY: Record<string, string> = {
  execute_bash: 'Bash',
  read_file: 'Read',
  write_file: 'Write',
  edit_file: 'Edit',
  list_directory: 'List',
  search_files: 'Grep',
  glob: 'Glob',
  web_fetch: 'WebFetch',
  skill: 'Skill',
};

export function parseRule(raw: string): PermissionRule | null {
  const m = raw.trim().match(/^([A-Za-z_][\w-]*)(?:\((.*)\))?$/);
  if (!m) return null;
  return { tool: m[1], spec: m[2], raw: raw.trim() };
}

export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(ch)) re += '\\' + ch;
    else re += ch;
  }
  return new RegExp(`^${re}$`);
}

export interface RuleTarget {
  /** Display tool name. */
  tool: string;
  /** Bash: full command; files: path relative to cwd; web: URL. */
  target: string;
  cwd: string;
}

export function ruleMatches(rule: PermissionRule, t: RuleTarget): boolean {
  if (rule.tool !== t.tool) return false;
  if (rule.spec === undefined || rule.spec === '' || rule.spec === '*') return true;
  const spec = rule.spec;
  if (t.tool === 'Bash') {
    const cmd = t.target.trim();
    if (spec.endsWith(':*')) {
      const prefix = spec.slice(0, -2);
      return cmd === prefix || cmd.startsWith(prefix + ' ');
    }
    return cmd === spec;
  }
  if (t.tool === 'WebFetch') {
    if (spec.startsWith('domain:')) {
      try {
        const host = new URL(t.target).hostname;
        const d = spec.slice(7);
        return host === d || host.endsWith('.' + d);
      } catch {
        return false;
      }
    }
    return t.target === spec;
  }
  const rel = path.isAbsolute(t.target) ? path.relative(t.cwd, t.target) : t.target;
  const normalized = rel.split(path.sep).join('/');
  const cleanSpec = spec.replace(/^\.\//, '');
  return globToRegExp(cleanSpec).test(normalized) || globToRegExp(cleanSpec).test('./' + normalized);
}

export interface Evaluation {
  decision: 'allow' | 'ask' | 'deny';
  risk: RiskLevel;
  reason: string;
  displayName: string;
  target: string;
  matchedRule?: string;
  /** Options to present when decision === 'ask'. */
  options: PermissionOption[];
  title: string;
  danger?: string;
}

export function toolTarget(name: string, args: Record<string, any>): string {
  switch (name) {
    case 'execute_bash': return String(args.command ?? '');
    case 'read_file': case 'write_file': case 'edit_file': return String(args.file_path ?? '');
    case 'list_directory': return String(args.dir_path ?? '.');
    case 'search_files': return String(args.path ?? '.');
    case 'glob': return String(args.pattern ?? '');
    case 'web_fetch': return String(args.url ?? '');
    case 'skill': return String(args.name ?? '');
    default: return JSON.stringify(args);
  }
}

export function baseRisk(name: string, args: Record<string, any>, cwd: string): { risk: RiskLevel; reason: string } {
  switch (name) {
    case 'execute_bash': {
      const c = classifyCommand(String(args.command ?? ''), cwd);
      return { risk: c.risk, reason: c.reason };
    }
    case 'read_file': case 'list_directory': case 'search_files': case 'glob': case 'skill':
      return { risk: 'read', reason: '' };
    case 'write_file': case 'edit_file':
      return { risk: 'edit', reason: '' };
    case 'web_fetch':
      return { risk: 'exec', reason: 'accès réseau' };
    default:
      return { risk: 'exec', reason: 'outil inconnu' };
  }
}

export function evaluatePermission(
  name: string,
  args: Record<string, any>,
  cwd: string,
  mode: PermissionMode,
  settings: Settings,
  projectName = path.basename(cwd)
): Evaluation {
  const displayName = TOOL_DISPLAY[name] ?? name;
  const target = toolTarget(name, args);
  const { risk, reason } = baseRisk(name, args, cwd);
  const ruleTarget: RuleTarget = { tool: displayName, target, cwd };

  const base: Omit<Evaluation, 'decision' | 'options' | 'title'> = { risk, reason, displayName, target };
  const options = buildOptions(name, args, cwd, projectName);
  const title = buildTitle(name, args);
  const danger = risk === 'danger' ? `Commande dangereuse : ${reason}` : undefined;

  const denyRules = (settings.permissions?.deny ?? []).map(parseRule).filter((r): r is PermissionRule => !!r);
  const allowRules = (settings.permissions?.allow ?? []).map(parseRule).filter((r): r is PermissionRule => !!r);

  const denied = denyRules.find((r) => ruleMatches(r, ruleTarget));
  if (denied) return { ...base, decision: 'deny', matchedRule: denied.raw, options, title, danger, reason: `règle deny ${denied.raw}` };

  if (mode === 'plan' && risk !== 'read') {
    return { ...base, decision: 'deny', options, title, danger, reason: 'plan mode' };
  }

  const allowed = allowRules.find((r) => ruleMatches(r, ruleTarget));
  if (allowed && risk !== 'danger') return { ...base, decision: 'allow', matchedRule: allowed.raw, options, title, danger };

  if (mode === 'bypassPermissions') return { ...base, decision: 'allow', options, title, danger };
  if (risk === 'read') return { ...base, decision: 'allow', options, title, danger };
  if (mode === 'acceptEdits' && risk === 'edit') return { ...base, decision: 'allow', options, title, danger };

  return { ...base, decision: 'ask', options, title, danger };
}

function buildTitle(name: string, args: Record<string, any>): string {
  switch (name) {
    case 'edit_file': return `Do you want to make this edit to ${args.file_path}?`;
    case 'write_file': return `Do you want to create ${args.file_path}?`;
    case 'execute_bash': return 'Do you want to proceed?';
    case 'web_fetch': return `Do you want to fetch ${args.url}?`;
    default: return `Do you want to run ${TOOL_DISPLAY[name] ?? name}?`;
  }
}

function buildOptions(name: string, args: Record<string, any>, cwd: string, projectName: string): PermissionOption[] {
  const no: PermissionOption = { value: 'no', label: 'No, and tell Fuller what to do differently (esc)' };
  switch (name) {
    case 'edit_file':
    case 'write_file':
      return [
        { value: 'yes', label: 'Yes' },
        { value: 'always', label: 'Yes, allow all edits during this session (shift+tab)', switchMode: 'acceptEdits' },
        no,
      ];
    case 'execute_bash': {
      const prefix = suggestPrefix(String(args.command ?? ''));
      const rule = `Bash(${prefix})`;
      return [
        { value: 'yes', label: 'Yes' },
        { value: 'always', label: `Yes, and don't ask again for \`${prefix.replace(/:\*$/, '')}\` commands in ${projectName}`, rule },
        no,
      ];
    }
    case 'web_fetch': {
      let host = '';
      try { host = new URL(String(args.url)).hostname; } catch {}
      const rule = `WebFetch(domain:${host})`;
      return [
        { value: 'yes', label: 'Yes' },
        { value: 'always', label: `Yes, and don't ask again for ${host}`, rule },
        no,
      ];
    }
    default:
      return [
        { value: 'yes', label: 'Yes' },
        { value: 'always', label: `Yes, and don't ask again for ${TOOL_DISPLAY[name] ?? name}`, rule: TOOL_DISPLAY[name] ?? name },
        no,
      ];
  }
}
