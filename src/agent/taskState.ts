import type { TodoItem } from './types.js';

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
  kind: 'todos' | 'verify' | 'failing';
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
  private lastCheck?: { command: string; version: number; exitCode: number };
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
    if (isInspection(command)) return;
    const codes = [...output.matchAll(/\[Exit code: (\d+)\]/g)];
    const exitCode = codes.length ? Number(codes[codes.length - 1][1]) : 0;
    this.lastCheck = { command, version: this.version, exitCode };
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
    const stale = check ? code.filter((f) => (this.changed.get(f) ?? 0) > check.version) : code;
    if (stale.length && !this.sent.has('verify')) {
      this.sent.add('verify');
      return {
        kind: 'verify',
        text: check
          ? `[Before you finish] You changed ${listFiles(stale)} after your last check (\`${check.command}\`). Run the relevant check again, then give your final answer. If it cannot be checked here, say so plainly instead of claiming it works.`
          : `[Before you finish] You changed ${listFiles(stale)} and ran no command to check the change. Run the relevant tests, type check or build now (or run the changed code), then give your final answer. If it cannot be checked here, say so plainly instead of claiming it works.`,
        notice: check ? 'Files changed after the last check · asking to check again' : 'No check run after the changes · asking to verify',
      };
    }
    if (check && !stale.length && check.exitCode !== 0 && !this.sent.has('failing')) {
      this.sent.add('failing');
      return {
        kind: 'failing',
        text: `[Before you finish] Your last check failed: \`${check.command}\` exited with code ${check.exitCode}. Fix the cause and run it again. If the failure is unrelated to your change or expected, say so plainly in your final answer.`,
        notice: `The last check failed (exit ${check.exitCode}) · asking to fix it or explain`,
      };
    }
    return null;
  }
}
