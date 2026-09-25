import type { TodoItem } from './types.js';
import path from 'node:path';
import { parseSegment } from '../permissions/bashParser.js';

/**
 * What the agent did during one user turn, so its work is checked before it concludes:
 * files changed (with a version number), the checks run after them, the task list, and
 * calls repeated without progress. Nothing here forbids an answer: each reminder is sent at
 * most once per turn, and the model may still conclude honestly (a check that cannot run
 * here, a failure unrelated to its change).
 */

/** Changes that need no test run: documentation and plain text. */
export function isDocFile(file: string): boolean {
  return /\.(md|mdx|markdown|txt|rst|adoc)$/i.test(file) || /(^|\/)docs?\//i.test(file);
}

const INSPECT = /^(cd|ls|cat|head|tail|less|grep|egrep|rg|ag|find|fd|tree|pwd|echo|printf|wc|which|type|file|stat|du|df|env|date|whoami|true|git\s+(status|diff|log|show|branch|blame|remote|rev-parse)|sed\s+-n)(\s|$)/;

/** A command that only looks around (ls, cat, grep, git status…): it proves nothing about a change. */
export function isInspection(command: string): boolean {
  const segments = command.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);
  return segments.length > 0 && segments.every((s) => INSPECT.test(s));
}

/** Redirections that change where output goes, never the exit code. */
const HARMLESS_REDIRECT = /\s*(?:\d?>&\d|&>>?\s*\/dev\/null|\d?>>?\s*\/dev\/null)(?=\s|$|;|&|\|)/g;
/** Programs that only shorten or filter a check's output (`npm test 2>&1 | tail -20`). */
const FILTERS = new Set(['tail', 'head', 'grep', 'egrep', 'rg', 'sort', 'uniq', 'less', 'more', 'cat', 'wc', 'cut']);

/**
 * Top-level shell structure: statements (;) of and-lists (&&) of pipelines (|), quotes honoured.
 * Null when `||`, a background `&`, a newline or a substitution makes the exit status unreliable.
 */
function shellStructure(command: string): string[][][] | null {
  if (/[\n`]|\$\(/.test(command)) return null;
  const statements: string[][][] = [];
  let andList: string[][] = [];
  let pipeline: string[] = [];
  let word = '';
  let quote: string | null = null;
  const endStage = () => { pipeline.push(word.trim()); word = ''; };
  const endPipeline = () => { endStage(); andList.push(pipeline); pipeline = []; };
  const endStatement = () => { endPipeline(); statements.push(andList); andList = []; };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    if (quote) {
      if (c === '\\' && quote === '"') { word += c + (next ?? ''); i++; continue; }
      if (c === quote) quote = null;
      word += c;
      continue;
    }
    if (c === '\\') { word += c + (next ?? ''); i++; continue; }
    if (c === '"' || c === "'") { quote = c; word += c; continue; }
    if (c === '|' && next === '|') return null;
    if (c === '&' && next === '&') { endPipeline(); i++; continue; }
    if (c === '&') {
      if (command[i - 1] === '>' || next === '>') { word += c; continue; }
      return null;
    }
    if (c === '|') { endStage(); continue; }
    if (c === ';') { endStatement(); continue; }
    word += c;
  }
  if (quote) return null;
  if (word.trim() || pipeline.length || andList.length) endStatement();
  if (!statements.length || statements.some((s) => s.some((p) => p.some((stage) => !stage)))) return null;
  return statements;
}

const TASK = /^(?:test|tests|check|typecheck|lint|build|verify|validate)(?:$|[:_-])/;

/** One simple command: a validation (tests, type check, lint, build), a look around, or something else. */
function stageKind(stage: string): 'check' | 'inspect' | 'other' {
  if (mayWrite(stage)) return 'other';
  const segment = parseSegment(stage);
  const program = path.basename(segment.program);
  const args = segment.args;
  if (segment.subshell || segment.wrappers.some((w) => !['env', 'timeout', 'nice', 'command', 'time'].includes(w))) return 'other';
  if (args.some((arg) => ['--version', '-V', '--help', '-h', '--listTests', '--list-tests', '--collect-only', '--init', '--showConfig', '--print-config', '--dry-run'].includes(arg))) return 'other';
  if (args.includes('-v') && ['node', 'npm', 'pnpm', 'yarn', 'bun', 'npx', 'vitest', 'jest', 'tsc', 'eslint'].includes(program)) return 'other';
  let check = false;
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(program)) {
    const action = args[0] === 'run' ? args[1] : args[0];
    check = args[0] === 'exec'
      ? ['vitest', 'jest', 'tsc', 'eslint'].includes(args[1]) && args[2] !== 'list'
      : TASK.test(action ?? '');
  } else if (program === 'node') {
    check = args.includes('--test') || args.includes('--check') || args.includes('-c');
  } else if (['pytest', 'vitest', 'jest', 'tsc', 'eslint', 'tslint', 'mypy', 'pyright'].includes(program)) {
    check = args[0] !== 'list';
  } else if (program === 'npx') {
    check = ['vitest', 'jest', 'tsc', 'eslint'].includes(args[0]) && args[1] !== 'list';
  } else if (/^python(?:3(?:\.\d+)?)?$/.test(program)) {
    check = args[0] === '-m' && ['pytest', 'unittest', 'py_compile', 'compileall'].includes(args[1]);
  } else if (['cargo', 'go', 'dotnet', 'make'].includes(program)) {
    check = TASK.test(args[0] ?? '');
  } else if (program === 'ruff') {
    check = args[0] === 'check';
  }
  if (check) return 'check';
  return isInspection(stage) ? 'inspect' : 'other';
}

/**
 * Whether a command validates the work, recognized conservatively (not a proof of coverage):
 * 'exact' when the command's exit code is the check's, 'unknown' when a filter such as
 * `| tail -20` sets it (the check ran, its result is not known), null for no check, or a
 * check whose failure could be hidden (`|| true`, `; true`, `&`, a write after it).
 */
export function checkStatus(command: string): 'exact' | 'unknown' | null {
  const statements = shellStructure(command.replace(HARMLESS_REDIRECT, ''));
  if (!statements) return null;
  let found = false;
  let exact = true;
  for (const [si, andList] of statements.entries()) {
    for (const pipeline of andList) {
      for (const [pi, stage] of pipeline.entries()) {
        if (pi > 0) {
          if (!FILTERS.has(path.basename(parseSegment(stage).program)) || mayWrite(stage)) return null;
          continue;
        }
        const kind = stageKind(stage);
        if (kind === 'other') return null;
        if (kind !== 'check') continue;
        // A later statement would set the exit code: `npm test; true` hides a failure.
        if (si < statements.length - 1) return null;
        found = true;
        if (pipeline.length > 1) exact = false;
      }
    }
  }
  return found ? (exact ? 'exact' : 'unknown') : null;
}

export function isCheckCommand(command: string): boolean {
  return checkStatus(command) !== null;
}

/** The same check whatever its harmless redirections or spacing: `npm test 2>&1` is `npm test`. */
function checkKey(command: string): string {
  return command.replace(HARMLESS_REDIRECT, '').replace(/\s+/g, ' ').trim();
}

/** A command that may change files (sed -i, a redirection, git checkout, an install…). */
export function mayWrite(command: string): boolean {
  return /(^|[\s;&|(])(sed\s+-i|perl\s+-\w*i|tee|mv|cp|rm|touch|mkdir|patch|git\s+(checkout|apply|stash|reset|restore|mv|rm|merge|rebase|cherry-pick)|npm\s+(i|install|ci|uninstall)|pnpm\s+(i|install|add)|yarn\s+(add|install)|pip3?\s+install)(\s|$)/.test(command)
    || /(^|[^0-9&>])>{1,2}\s*[^&\s]/.test(command.replace(/\d?>\s*\/dev\/null/g, ''));
}

/** JSON with sorted keys: the same arguments always give the same text. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Hypotheses to measure on the benchmark, like Gemini CLI's own thresholds. */
export const REPEAT_LIMIT = 4;
export const FAILURE_LIMIT = 3;
/** Polling a background task repeats the same call on purpose. */
const POLLING = new Set(['task_output']);

export type ProgressVerdict = { level: 'ok' } | { level: 'warn' | 'stop'; reason: string };

export interface Reminder {
  kind: 'todos' | 'verify' | 'failing' | 'unconfirmed';
  /** Sent to the model. */
  text: string;
  /** Shown to the user. */
  notice: string;
}

function listFiles(files: string[]): string {
  const shown = files.slice(0, 5).map((f) => `\`${f}\``).join(', ');
  return files.length > 5 ? `${shown} and ${files.length - 5} more` : shown;
}

export class WorkTracker {
  /** Goes up whenever files may have changed. */
  version = 0;
  /** A review of this turn's changes already ran. */
  reviewed = false;
  private readonly changed = new Map<string, number>();
  /** exitCode null: the check ran behind a filter (`| tail`), its result is unknown. */
  private lastCheck?: { command: string; version: number; exitCode: number | null };
  /** Version of the files when a check last passed with a known exit code. */
  private passedAt = -1;
  private readonly failedChecks = new Map<string, { command: string; exitCode: number }>();
  private readonly sent = new Set<Reminder['kind']>();
  private readonly calls = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  private warned = false;

  /** Files changed by the agent's tools (an edit, a write, a subagent), relative to the workspace. */
  noteChanges(files: string[]): void {
    if (!files.length) return;
    this.version++;
    for (const file of files) this.changed.set(file, this.version);
  }

  /** A foreground command and its output (the tool appends "[Exit code: N]" when it fails). */
  noteCommand(command: string, output: string): void {
    if (mayWrite(command)) this.version++;
    const status = checkStatus(command);
    if (!status) return;
    const codes = [...output.matchAll(/^\[Exit code: (-?\d+)\]$/gm)];
    const exitCode = status === 'unknown' ? null : codes.length ? Number(codes[codes.length - 1][1]) : /\[Command timed out/.test(output) ? 1 : 0;
    this.lastCheck = { command, version: this.version, exitCode };
    // A result behind a filter neither clears nor records a failure.
    if (exitCode === 0) { this.failedChecks.delete(checkKey(command)); this.passedAt = this.version; }
    else if (exitCode !== null) this.failedChecks.set(checkKey(command), { command, exitCode });
  }

  changedFiles(): string[] {
    return [...this.changed.keys()];
  }

  /**
   * No progress: the same call with the same arguments while no file changed, or the same
   * failure again. The first time asks the model to step back; after that, stop the turn.
   * Call it before noting the call's own changes.
   */
  recordCall(name: string, args: Record<string, unknown>, error?: string): ProgressVerdict {
    if (POLLING.has(name)) return { level: 'ok' };
    const key = `${name}${stable(args)}@${this.version}`;
    const repeats = (this.calls.get(key) ?? 0) + 1;
    this.calls.set(key, repeats);
    let reason = repeats >= REPEAT_LIMIT ? `the same ${name} call ${repeats} times while no file changed` : '';
    if (error) {
      const first = error.split('\n')[0].slice(0, 160);
      const target = String(args.file_path ?? args.command ?? args.path ?? '');
      const failKey = `${name}|${target}|${first}@${this.version}`;
      const count = (this.failures.get(failKey) ?? 0) + 1;
      this.failures.set(failKey, count);
      if (count >= FAILURE_LIMIT) reason = `the same ${name} error ${count} times ("${first}")`;
    }
    if (!reason) return { level: 'ok' };
    if (!this.warned) {
      this.warned = true;
      return { level: 'warn', reason };
    }
    return { level: 'stop', reason };
  }

  /**
   * Before the model concludes: what is left to check, at most once per kind and per turn.
   * `todos` is the task list when the model wrote one during this turn.
   */
  beforeConclude(todos: TodoItem[] | null): Reminder | null {
    const open = todos?.filter((t) => t.status !== 'completed') ?? [];
    if (open.length && !this.sent.has('todos')) {
      this.sent.add('todos');
      return {
        kind: 'todos',
        text: `[Before you finish] Your task list still has unfinished items:\n${open.map((t) => `- ${t.content} (${t.status})`).join('\n')}\nFinish them, or update the list with todo_write and say in your answer what is left and why.`,
        notice: 'Task list not finished · asking to finish it or explain',
      };
    }
    const code = this.changedFiles().filter((f) => !isDocFile(f));
    if (!code.length) return null;
    const check = this.lastCheck;
    const stale = check
      ? code.filter((f) => (this.changed.get(f) ?? 0) > check.version)
      : code;
    // Shell writes may affect tracked files without producing a new checkpoint.
    if (check && check.version < this.version && !stale.length) stale.push(...code);
    if (stale.length && !this.sent.has('verify')) {
      this.sent.add('verify');
      return {
        kind: 'verify',
        text: check
          ? `[Before you finish] You changed ${listFiles(stale)} after your last check (\`${check.command}\`). Run the relevant check again, then give your final answer. If it cannot be checked here, say so plainly instead of claiming it works.`
          : `[Before you finish] You changed ${listFiles(stale)}, and no test, type check, lint or build command ran after the change. Run the relevant one now, then give your final answer. If the project has none or the change cannot be checked here, say so plainly instead of claiming it works.`,
        notice: check ? 'Files changed after the last check · asking to check again' : 'No check run after the changes · asking to verify',
      };
    }
    const failure = this.failedChecks.values().next().value;
    if (failure && !stale.length && !this.sent.has('failing')) {
      this.sent.add('failing');
      return {
        kind: 'failing',
        text: `[Before you finish] A check still needs attention: \`${failure.command}\` exited with code ${failure.exitCode}. Fix the cause and run it again as is, without piping its output, so its exit code shows. A different passing check does not resolve this failure. If the failure is unrelated to your change or expected, say so plainly in your final answer.`,
        notice: `A check failed (exit ${failure.exitCode}) · asking to fix it or explain`,
      };
    }
    // A check behind a filter ran, but its result is not verified: ask once for its exit code.
    if (check && !stale.length && check.exitCode === null && this.passedAt < this.version && !this.sent.has('unconfirmed')) {
      this.sent.add('unconfirmed');
      return {
        kind: 'unconfirmed',
        text: `[Before you finish] Your last check (\`${check.command}\`) ran behind a pipe, so its exit code is unknown. Run it once as is, without piping its output, then give your final answer from that result.`,
        notice: 'Check result unknown (output piped) · asking to confirm it',
      };
    }
    return null;
  }
}
