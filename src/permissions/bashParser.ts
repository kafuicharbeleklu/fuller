import path from 'node:path';

export type RiskLevel = 'read' | 'edit' | 'exec' | 'danger';

const RISK_ORDER: Record<RiskLevel, number> = { read: 0, edit: 1, exec: 2, danger: 3 };

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export interface Redirect {
  op: string;
  target: string;
}

export interface CommandSegment {
  raw: string;
  /** Program after stripping env assignments and wrappers (timeout, nice, nohup, command, env, time). */
  program: string;
  args: string[];
  redirects: Redirect[];
  subshell: boolean;
  /** Wrappers that were stripped (sudo is NOT stripped: it is classified as danger). */
  wrappers: string[];
}

export interface Classification {
  risk: RiskLevel;
  reason: string;
  segments: CommandSegment[];
}

const OPERATORS = ['&&', '||', ';', '|', '&', '\n'];

/**
 * Split a shell command line into segments on &&, ||, ;, |, & and newlines,
 * honouring single/double quotes and backslash escapes. Command substitutions
 * ($(...) and `...`) are extracted as additional segments flagged `subshell`.
 */
export function splitCommand(cmd: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let depth = 0;
  const subshells: string[] = [];
  let sub = '';
  let backtick = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    const next = cmd[i + 1];

    if (quote === "'") {
      if (ch === "'") quote = null;
      if (depth > 0) sub += ch; else current += ch;
      continue;
    }
    if (ch === '\\' && next !== undefined) {
      if (depth > 0) sub += ch + next; else current += ch + next;
      i++;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      if (ch === '$' && next === '(') {
        depth++;
        if (depth === 1) { sub = ''; i++; continue; }
      } else if (depth > 0 && ch === ')') {
        depth--;
        if (depth === 0) { subshells.push(sub); sub = ''; continue; }
      }
      if (depth > 0) sub += ch; else current += ch;
      continue;
    }
    if (ch === '`') {
      backtick = !backtick;
      if (!backtick) { subshells.push(sub); sub = ''; } else { sub = ''; }
      continue;
    }
    if (backtick) { sub += ch; continue; }
    if (ch === '"' || ch === "'") {
      quote = ch;
      if (depth > 0) sub += ch; else current += ch;
      continue;
    }
    if (ch === '$' && next === '(') {
      depth++;
      if (depth === 1) { sub = ''; i++; continue; }
      sub += ch;
      continue;
    }
    if (depth > 0) {
      if (ch === '(') depth++;
      if (ch === ')') {
        depth--;
        if (depth === 0) { subshells.push(sub); sub = ''; continue; }
      }
      sub += ch;
      continue;
    }
    const two = ch + (next ?? '');
    if (OPERATORS.includes(two)) {
      segments.push(current);
      current = '';
      i++;
      continue;
    }
    if (ch === '&' && next === '>') { current += ch; continue; }
    if (ch === '>' && cmd[i - 1] === '&') { current += ch; continue; }
    if (ch === '|' && cmd[i - 1] === '>') { current += ch; continue; }
    if (OPERATORS.includes(ch)) {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (depth > 0 || backtick) subshells.push(sub);
  segments.push(current);

  const out = segments.map((s) => s.trim()).filter(Boolean);
  for (const s of subshells) {
    for (const inner of splitCommand(s)) out.push(`\u0000${inner}`);
  }
  return out;
}

function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let has = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (ch === '\\' && quote === '"' && i + 1 < segment.length) { cur += segment[++i]; continue; }
      cur += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < segment.length) { cur += segment[++i]; has = true; continue; }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (/\s/.test(ch)) {
      if (has || cur) { tokens.push(cur); cur = ''; has = false; }
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has || cur) tokens.push(cur);
  return tokens;
}

const WRAPPERS_WITH_ARG = new Set(['timeout', 'nice', 'ionice']);
const WRAPPERS = new Set(['nohup', 'command', 'builtin', 'time', 'env', 'exec', 'xargs', 'stdbuf', 'unbuffer']);

export function parseSegment(raw: string): CommandSegment {
  const subshell = raw.startsWith('\u0000');
  const text = subshell ? raw.slice(1) : raw;
  const tokens = tokenize(text);
  const redirects: Redirect[] = [];
  const words: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m = t.match(/^(\d*)(>>|>\||>|<<<|<<|<)(&\d+|&-)?(.*)$/);
    if (m && !t.startsWith('<<')) {
      const op = m[2];
      let target = m[4];
      if (m[3]) { redirects.push({ op, target: m[3] }); continue; }
      if (!target) target = tokens[++i] ?? '';
      redirects.push({ op, target });
      continue;
    }
    words.push(t);
  }

  const wrappers: string[] = [];
  let idx = 0;
  while (idx < words.length) {
    const w = words[idx];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { idx++; continue; }
    if (WRAPPERS_WITH_ARG.has(w)) {
      wrappers.push(w);
      idx++;
      if (w === 'nice' && words[idx] === '-n') idx += 2;
      else if (w === 'nice' && /^-\d+$/.test(words[idx] ?? '')) idx++;
      else if (w === 'timeout') {
        while (words[idx]?.startsWith('-')) idx += words[idx] === '-s' || words[idx] === '-k' ? 2 : 1;
        idx++;
      } else idx++;
      continue;
    }
    if (WRAPPERS.has(w)) {
      wrappers.push(w);
      idx++;
      if (w === 'xargs' || w === 'env' || w === 'stdbuf') {
        while (words[idx]?.startsWith('-')) idx++;
      }
      continue;
    }
    break;
  }
  const program = words[idx] ?? '';
  const args = words.slice(idx + 1);
  return { raw: text, program: path.basename(program), args, redirects, subshell, wrappers };
}

const READ_ONLY = new Set([
  'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'egrep', 'fgrep', 'ag', 'ack', 'pwd', 'echo', 'printf',
  'wc', 'sort', 'uniq', 'cut', 'tr', 'diff', 'cmp', 'file', 'stat', 'du', 'df', 'which', 'whereis',
  'type', 'date', 'uname', 'whoami', 'id', 'hostname', 'tree', 'basename', 'dirname', 'realpath',
  'readlink', 'jq', 'yq', 'true', 'false', 'test', '[', 'seq', 'sleep', 'cd', 'export', 'set', 'unset',
  'alias', 'history', 'clear', 'less', 'more', 'md5sum', 'sha256sum', 'sha1sum', 'base64', 'xxd', 'od',
  'hexdump', 'strings', 'nl', 'tac', 'rev', 'column', 'paste', 'join', 'comm', 'expr', 'bc', 'env',
  'printenv', 'locale', 'getconf', 'nproc', 'free', 'uptime', 'ps', 'top', 'lsof', 'netstat', 'ss', 'ip',
  'ifconfig', 'ping', 'dig', 'nslookup', 'host', 'man', 'help', 'info', 'tput', 'stty', 'tty', 'wc',
]);

const EDIT_PROGRAMS = new Set(['mkdir', 'touch', 'cp', 'mv', 'rmdir', 'ln', 'tee', 'truncate']);

const SUBCOMMAND_PROGRAMS = new Set([
  'npm', 'npx', 'yarn', 'pnpm', 'bun', 'deno', 'git', 'docker', 'cargo', 'go', 'make', 'python', 'python3',
  'pip', 'pip3', 'node', 'kubectl', 'gh', 'brew', 'apt', 'apt-get', 'gradle', 'mvn', 'poetry', 'uv', 'rails',
  'bundle', 'gem', 'composer', 'php', 'dotnet', 'terraform', 'aws', 'gcloud', 'az', 'helm', 'systemctl',
]);

const DANGER_PROGRAMS = new Set([
  'sudo', 'su', 'doas', 'shutdown', 'reboot', 'halt', 'poweroff', 'mkfs', 'dd', 'fdisk', 'parted',
  'mkswap', 'wipefs', 'shred', 'crontab', 'iptables', 'nft', 'ufw', 'passwd', 'useradd', 'userdel', 'usermod',
]);

const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh']);

const GIT_READ = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'blame', 'describe', 'shortlog',
  'reflog', 'cat-file', 'rev-list', 'name-rev', 'grep', 'whatchanged', 'count-objects', 'var', 'version',
  'help', 'check-ignore', 'ls-remote',
]);

function isInsideWorkspace(p: string, cwd: string): boolean {
  if (!p || p.startsWith('-')) return true;
  if (p.includes('$') || p.includes('~')) return false;
  const resolved = path.resolve(cwd, p);
  const rel = path.relative(cwd, resolved);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function pathArgs(args: string[]): string[] {
  return args.filter((a) => !a.startsWith('-'));
}

function hasFlag(args: string[], ...flags: string[]): boolean {
  return args.some((a) => {
    if (flags.includes(a)) return true;
    if (/^-[a-zA-Z]+$/.test(a)) {
      return flags.some((f) => /^-[a-zA-Z]$/.test(f) && a.includes(f[1]));
    }
    return false;
  });
}

function classifySegment(seg: CommandSegment, cwd: string, pipelineToShell: boolean): { risk: RiskLevel; reason: string } {
  const { program, args, redirects, wrappers } = seg;
  let risk: RiskLevel = 'read';
  let reason = '';

  const escalate = (r: RiskLevel, why: string) => {
    if (RISK_ORDER[r] > RISK_ORDER[risk]) { risk = r; reason = why; }
  };

  if (!program) {
    if (redirects.length) escalate('edit', 'redirection');
    return { risk, reason };
  }

  if (wrappers.includes('exec')) escalate('exec', 'exec');

  if (DANGER_PROGRAMS.has(program)) return { risk: 'danger', reason: `${program} (privileges / system)` };

  if (program === 'rm') {
    const recursive = hasFlag(args, '-r', '-R', '--recursive');
    const targets = pathArgs(args);
    const outside = targets.some((t) => !isInsideWorkspace(t, cwd));
    const rootish = targets.some((t) => /^(\/|~|\.\.|\/\*|\*)$/.test(t.trim()) || t.startsWith('/') || t.startsWith('~'));
    if (rootish || (recursive && outside)) return { risk: 'danger', reason: 'rm outside the project or on the root' };
    if (recursive) return { risk: 'exec', reason: 'recursive rm' };
    if (outside) return { risk: 'exec', reason: 'rm outside the project' };
    return { risk: 'edit', reason: 'rm inside the project' };
  }

  if (program === 'git') {
    const sub = args.find((a) => !a.startsWith('-')) ?? '';
    const rest = args.slice(args.indexOf(sub) + 1);
    if (sub === 'push' && hasFlag(rest, '-f', '--force', '--force-with-lease')) return { risk: 'danger', reason: 'git push --force' };
    if (sub === 'reset' && rest.includes('--hard')) return { risk: 'danger', reason: 'git reset --hard' };
    if (sub === 'clean' && hasFlag(rest, '-f', '-x', '-d', '--force')) return { risk: 'danger', reason: 'git clean -f' };
    if (sub === 'branch' && hasFlag(rest, '-D')) return { risk: 'danger', reason: 'git branch -D' };
    if ((sub === 'checkout' || sub === 'restore') && (rest.includes('.') || rest.includes('--') )) return { risk: 'danger', reason: `git ${sub} overwrites local changes` };
    if (sub === 'stash' && (rest.includes('drop') || rest.includes('clear'))) return { risk: 'danger', reason: 'git stash drop/clear' };
    if (GIT_READ.has(sub)) return { risk: 'read', reason: '' };
    if (sub === 'branch' && !rest.some((a) => !a.startsWith('-') ) && !hasFlag(rest, '-d', '-m', '-M')) return { risk: 'read', reason: '' };
    if (sub === 'tag' && (rest.length === 0 || rest.includes('-l') || rest.includes('--list'))) return { risk: 'read', reason: '' };
    if (sub === 'remote' && (rest.length === 0 || rest[0] === '-v' || rest[0] === 'show' || rest[0] === 'get-url')) return { risk: 'read', reason: '' };
    if (sub === 'config' && (rest.includes('--get') || rest.includes('-l') || rest.includes('--list') || rest.length === 1)) return { risk: 'read', reason: '' };
    if (sub === 'stash' && rest[0] === 'list') return { risk: 'read', reason: '' };
    if (sub === 'worktree' && rest[0] === 'list') return { risk: 'read', reason: '' };
    return { risk: 'exec', reason: `git ${sub}` };
  }

  if (program === 'find') {
    if (hasFlag(args, '-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprintf', '-fls')) return { risk: 'exec', reason: 'find with an action' };
    return { risk: redirects.length ? 'edit' : 'read', reason: '' };
  }

  if (program === 'sed' || program === 'perl') {
    if (hasFlag(args, '-i', '--in-place') || args.some((a) => /^-i/.test(a))) {
      const outside = pathArgs(args).some((t) => !/^s[/|#,]/.test(t) && !isInsideWorkspace(t, cwd));
      return { risk: outside ? 'exec' : 'edit', reason: 'in-place edit' };
    }
    if (program === 'perl' && (args.includes('-e') || args.includes('-E'))) return { risk: 'exec', reason: 'perl -e' };
    return { risk: redirects.length ? 'edit' : 'read', reason: '' };
  }

  if (program === 'awk' || program === 'gawk') {
    const script = args.join(' ');
    if (/system\s*\(|>\s*"|\|\s*"/.test(script)) return { risk: 'exec', reason: 'awk with side effects' };
    return { risk: redirects.length ? 'edit' : 'read', reason: '' };
  }

  if (program === 'chmod' || program === 'chown' || program === 'chgrp') {
    if (hasFlag(args, '-R', '--recursive') || args.includes('777')) return { risk: 'danger', reason: `recursive ${program} / 777` };
    return { risk: 'exec', reason: program };
  }

  if (program === 'kill' || program === 'killall' || program === 'pkill') {
    if (args.includes('-1') || args.includes('-9') && args.includes('-1')) return { risk: 'danger', reason: 'kills every process' };
    return { risk: 'exec', reason: program };
  }

  if (SHELLS.has(program)) {
    if (pipelineToShell) return { risk: 'danger', reason: 'remote content run by a shell' };
    return { risk: 'exec', reason: `${program} -c` };
  }

  if (program === 'eval' || program === 'source' || program === '.') return { risk: 'exec', reason: program };

  if (program === 'curl' || program === 'wget') {
    if (pipelineToShell) return { risk: 'danger', reason: 'download run by a shell' };
    const writes = program === 'curl' ? hasFlag(args, '-o', '-O', '--output', '--remote-name') : !args.includes('-O-') && !hasFlag(args, '-qO-');
    return { risk: writes || redirects.length ? 'exec' : 'exec', reason: 'network access' };
  }

  if (EDIT_PROGRAMS.has(program)) {
    const targets = pathArgs(args);
    const outside = targets.some((t) => !isInsideWorkspace(t, cwd));
    return { risk: outside ? 'exec' : 'edit', reason: outside ? `${program} outside the project` : '' };
  }

  if (READ_ONLY.has(program)) {
    if (program === 'echo' || program === 'printf' || program === 'cat' || program === 'tee') {
      if (redirects.some((r) => r.op !== '<' && r.target !== '/dev/null' && !r.target.startsWith('&'))) {
        const target = redirects.find((r) => r.op !== '<')!.target;
        return { risk: isInsideWorkspace(target, cwd) ? 'edit' : 'exec', reason: 'redirect to a file' };
      }
    }
    if (redirects.some((r) => (r.op === '>' || r.op === '>>' || r.op === '>|') && !r.target.startsWith('&') && r.target !== '/dev/null')) {
      const target = redirects.find((r) => r.op.startsWith('>'))!.target;
      return { risk: isInsideWorkspace(target, cwd) ? 'edit' : 'exec', reason: 'redirect to a file' };
    }
    return { risk, reason };
  }

  if (program === 'node' && (args[0] === '-v' || args[0] === '--version')) return { risk: 'read', reason: '' };
  if ((program === 'npm' || program === 'npx' || program === 'pnpm' || program === 'yarn') && ['-v', '--version', 'ls', 'list', 'view', 'info', 'help', 'why', 'outdated', 'audit'].includes(args[0] ?? '')) {
    return { risk: 'read', reason: '' };
  }
  if ((program === 'python' || program === 'python3' || program === 'go' || program === 'cargo' || program === 'rustc' || program === 'java' || program === 'tsc') && (args[0] === '--version' || args[0] === '-V' || args[0] === 'version' || args[0] === '-v')) {
    return { risk: 'read', reason: '' };
  }

  return { risk: 'exec', reason: `${program}` };
}

export function classifyCommand(command: string, cwd: string): Classification {
  const rawSegments = splitCommand(command);
  const segments = rawSegments.map(parseSegment);
  let risk: RiskLevel = 'read';
  let reason = '';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const nextRaw = rawSegments[i + 1];
    const nextProgram = nextRaw ? parseSegment(nextRaw).program : '';
    const pipelineToShell = (seg.program === 'curl' || seg.program === 'wget') && SHELLS.has(nextProgram);
    const shellFedByNetwork = SHELLS.has(seg.program) && i > 0 && ['curl', 'wget'].includes(segments[i - 1].program);
    const r = classifySegment(seg, cwd, pipelineToShell || shellFedByNetwork);
    if (RISK_ORDER[r.risk] > RISK_ORDER[risk]) {
      risk = r.risk;
      reason = r.reason;
    }
  }
  if (/:\(\)\s*\{\s*:\|:&\s*\};:/.test(command)) { risk = 'danger'; reason = 'fork bomb'; }
  return { risk, reason, segments };
}

/** Suggest a prefix rule spec ("npm test:*") for the "don't ask again" option. */
export function suggestPrefix(command: string): string {
  const first = splitCommand(command).find((s) => !s.startsWith('\u0000')) ?? command;
  const seg = parseSegment(first);
  const words = tokenize(first).filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  const programIndex = words.findIndex((w) => path.basename(w) === seg.program);
  const program = words[programIndex] ?? seg.program;
  const sub = words[programIndex + 1];
  if (SUBCOMMAND_PROGRAMS.has(seg.program) && sub && !sub.startsWith('-')) {
    return `${program} ${sub}:*`;
  }
  return `${program}:*`;
}

export function describeRisk(risk: RiskLevel): string {
  switch (risk) {
    case 'read': return 'read-only';
    case 'edit': return 'edits project files';
    case 'exec': return 'runs a program';
    case 'danger': return 'DANGEROUS';
  }
}
