import path from 'node:path';
import type { PermissionMode, PermissionOption } from '../agent/types.js';
import type { Settings } from '../config.js';
import { classifyCommand, splitCommand, suggestPrefix, type RiskLevel } from './bashParser.js';

export interface PermissionRule {
  tool: string;
  spec?: string;
  raw: string;
}

export const TOOL_DISPLAY: Record<string, string> = {
  execute_bash: 'Bash',
  read_file: 'Read',
  // An outline reads the file: Read(...) allow, ask and deny rules apply to it too.
  outline_file: 'Read',
  write_file: 'Write',
  edit_file: 'Edit',
  list_directory: 'List',
  search_files: 'Grep',
  glob: 'Glob',
  web_fetch: 'WebFetch',
  skill: 'Skill',
  todo_write: 'TodoWrite',
  task_output: 'TaskOutput',
  task_kill: 'TaskKill',
  exit_plan_mode: 'ExitPlanMode',
  agent: 'Agent',
  memory: 'Memory',
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
  if (rule.tool !== t.tool) {
    // "mcp__server" (no spec) covers every tool of that MCP server.
    if (rule.tool.startsWith('mcp__') && rule.spec === undefined && t.tool.startsWith(`${rule.tool}__`)) return true;
    return false;
  }
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
    case 'read_file': case 'outline_file': case 'write_file': case 'edit_file': return String(args.file_path ?? '');
    case 'list_directory': return String(args.dir_path ?? '.');
    case 'search_files': return String(args.path ?? '.');
    case 'glob': return String(args.pattern ?? '');
    case 'web_fetch': return String(args.url ?? '');
    case 'skill': return String(args.name ?? '');
    case 'todo_write': return 'todos';
    default: return JSON.stringify(args);
  }
}

export function baseRisk(name: string, args: Record<string, any>, cwd: string): { risk: RiskLevel; reason: string } {
  switch (name) {
    case 'execute_bash': {
      const c = classifyCommand(String(args.command ?? ''), cwd);
      return { risk: c.risk, reason: c.reason };
    }
    case 'read_file': case 'outline_file': case 'list_directory': case 'search_files': case 'glob': case 'skill': case 'todo_write': case 'task_output': case 'task_kill': case 'exit_plan_mode': case 'agent': case 'memory':
      return { risk: 'read', reason: '' };
    case 'write_file': case 'edit_file':
      return { risk: 'edit', reason: '' };
    case 'web_fetch':
      return { risk: 'exec', reason: 'accès réseau' };
    default:
      return { risk: 'exec', reason: name.startsWith('mcp__') ? 'outil MCP' : 'outil inconnu' };
  }
}

export function evaluatePermission(
  name: string,
  args: Record<string, any>,
  cwd: string,
  mode: PermissionMode,
  settings: Settings,
  _projectName = path.basename(cwd)
): Evaluation {
  const displayName = TOOL_DISPLAY[name] ?? name;
  const target = toolTarget(name, args);
  const { risk, reason } = baseRisk(name, args, cwd);
  const ruleTarget: RuleTarget = { tool: displayName, target, cwd };

  const base: Omit<Evaluation, 'decision' | 'options' | 'title'> = { risk, reason, displayName, target };
  const denyRules = (settings.permissions?.deny ?? []).map(parseRule).filter((r): r is PermissionRule => !!r);
  const allowRules = (settings.permissions?.allow ?? []).map(parseRule).filter((r): r is PermissionRule => !!r);
  const options = buildOptions(name, args, cwd, risk, allowRules);
  const title = buildTitle(name, args);
  const danger = risk === 'danger' ? `Commande dangereuse : ${reason}` : undefined;

  // Deny rules apply when the whole command or any subcommand matches, as in Claude Code.
  const denied = denyRules.find((r) => ruleMatches(r, ruleTarget) || (name === 'execute_bash' && bashSubcommands(target).some((sub) => ruleMatches(r, { ...ruleTarget, target: sub }))));
  if (denied) return { ...base, decision: 'deny', matchedRule: denied.raw, options, title, danger, reason: `règle deny ${denied.raw}` };

  // Ask rules win over allow rules and permissive modes (Claude Code: "always ask for confirmation").
  const askRules = (settings.permissions?.ask ?? []).map(parseRule).filter((r): r is PermissionRule => !!r);
  const askRule = askRules.find((r) => ruleMatches(r, ruleTarget) || (name === 'execute_bash' && bashSubcommands(target).some((sub) => ruleMatches(r, { ...ruleTarget, target: sub }))));

  if (mode === 'plan' && risk !== 'read') {
    return { ...base, decision: 'deny', options, title, danger, reason: 'plan mode' };
  }

  if (askRule) return { ...base, decision: 'ask', matchedRule: askRule.raw, options, title, danger };

  const allowed = name === 'execute_bash' ? bashAllowRule(target, cwd, allowRules, ruleTarget) : allowRules.find((r) => ruleMatches(r, ruleTarget));
  if (allowed && risk !== 'danger') return { ...base, decision: 'allow', matchedRule: allowed.raw, options, title, danger };

  if (mode === 'bypassPermissions') return { ...base, decision: 'allow', options, title, danger };
  if (risk === 'read') return { ...base, decision: 'allow', options, title, danger };
  // Auto mode lets workspace edits through like accept edits; the classifier judges the rest.
  if ((mode === 'acceptEdits' || mode === 'auto') && risk === 'edit') return { ...base, decision: 'allow', options, title, danger };

  return { ...base, decision: 'ask', options, title, danger };
}

function buildTitle(name: string, args: Record<string, any>): string {
  switch (name) {
    case 'edit_file': return `Do you want to make this edit to ${args.file_path}?`;
    case 'write_file': return `Do you want to create ${args.file_path}?`;
    case 'execute_bash': return 'Do you want to run this command?';
    case 'web_fetch': return `Do you want to fetch ${args.url}?`;
    default: return name.startsWith('mcp__') ? `Do you want to call the MCP tool ${name.split('__').slice(2).join('__')} (server ${name.split('__')[1]})?` : `Do you want to run ${TOOL_DISPLAY[name] ?? name}?`;
  }
}

/** Subcommands of a Bash command, including those nested in subshells and substitutions. */
export function bashSubcommands(command: string): string[] {
  return splitCommand(command).map((s) => s.replace(/^\u0000/, '').trim()).filter(Boolean);
}

/**
 * A Bash command is allowed when one rule matches it whole, or when each of its
 * subcommands is read-only or matched by a rule. A prefix rule such as
 * `Bash(npm test:*)` must not approve `npm test && git push`.
 */
function bashAllowRule(command: string, cwd: string, allowRules: PermissionRule[], ruleTarget: RuleTarget): PermissionRule | undefined {
  const whole = allowRules.find((r) => ruleMatches(r, ruleTarget));
  const subcommands = bashSubcommands(command);
  if (subcommands.length <= 1) return whole;
  // An exact rule written for the full compound string still approves it.
  if (whole && whole.spec === command.trim()) return whole;
  let matched: PermissionRule | undefined;
  for (const sub of subcommands) {
    const rule = allowRules.find((r) => ruleMatches(r, { ...ruleTarget, target: sub }));
    if (rule) matched ??= rule;
    else if (classifyCommand(sub, cwd).risk !== 'read') return undefined;
  }
  return matched;
}

/** Prefix rules to save for "don't ask again": one per subcommand that still needs approval. */
function bashRulePrefixes(command: string, cwd: string, allowRules: PermissionRule[]): string[] {
  const prefixes: string[] = [];
  for (const sub of bashSubcommands(command)) {
    if (classifyCommand(sub, cwd).risk === 'read') continue;
    if (allowRules.some((r) => ruleMatches(r, { tool: 'Bash', target: sub, cwd }))) continue;
    const prefix = suggestPrefix(sub);
    if (!prefixes.includes(prefix)) prefixes.push(prefix);
  }
  return prefixes;
}

const listNames = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];

function buildOptions(name: string, args: Record<string, any>, cwd: string, risk: RiskLevel, allowRules: PermissionRule[]): PermissionOption[] {
  const no: PermissionOption = { value: 'no', label: 'No' };
  switch (name) {
    case 'edit_file':
    case 'write_file':
      return [
        { value: 'yes', label: 'Yes' },
        { value: 'always', label: 'Yes, and switch to `accept edits (auto-approve file edits and common file commands)` for this session `(shift+tab)`', switchMode: 'acceptEdits' },
        no,
      ];
    case 'execute_bash': {
      const command = String(args.command ?? '');
      // Dangerous commands are never covered by an allow rule, so offering to
      // save one would be misleading. Like Claude Code, a compound command
      // saves one rule per subcommand that needs approval, up to 5; beyond
      // that the prompt only offers a one-time approval.
      const prefixes = risk === 'danger' ? [] : bashRulePrefixes(command, cwd, allowRules);
      if (!prefixes.length || prefixes.length > 5) return [{ value: 'yes', label: 'Yes' }, no];
      const rules = prefixes.map((prefix) => `Bash(${prefix})`);
      const names = prefixes.map((prefix) => `\`${prefix.replace(/:\*$/, '')}\``);
      return [
        { value: 'yes', label: 'Yes' },
        { value: 'always', label: `Yes, and don't ask again for ${listNames(names)} commands in \`${cwd}\``, rule: rules[0], ...(rules.length > 1 ? { rules } : {}) },
        no,
      ];
    }
    case 'web_fetch': {
      let host = '';
      try { host = new URL(String(args.url)).hostname; } catch {}
      const rule = `WebFetch(domain:${host})`;
      return [
        { value: 'yes', label: 'Yes' },
        { value: 'always', label: `Yes, and don't ask again for \`${host}\``, rule },
        no,
      ];
    }
    default: {
      const display = TOOL_DISPLAY[name] ?? name;
      const server = name.startsWith('mcp__') ? name.split('__')[1] : undefined;
      return [
        { value: 'yes', label: 'Yes' },
        { value: 'always', label: server ? `Yes, and don't ask again for \`${display}\` (MCP ${server})` : `Yes, and don't ask again for \`${display}\``, rule: display },
        no,
      ];
    }
  }
}
