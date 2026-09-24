import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseSegment, splitCommand } from '../permissions/bashParser.js';

/** A sudo command: the password box stays on Fuller's screen, and sudo reads the password itself. */
export interface TerminalAuth {
  auth: string;
}

/**
 * The UI owns terminal input outside this callback; the child owns it inside. `banner` is the text
 * shown on the plain terminal (an editor, ctrl+z), or `{ auth: command }` for a sudo password.
 */
export type RunInTerminal = <T>(run: () => Promise<T>, banner?: string | TerminalAuth) => Promise<T>;

export function needsNativeTerminal(command: string): boolean {
  return splitCommand(command).map(parseSegment).some((segment) => path.basename(segment.program) === 'sudo');
}

/**
 * Why a command would authenticate in a desktop window instead of Fuller (pkexec, sudo -A or
 * --askpass), or null. The model is told to use plain sudo; this enforces it.
 */
export function desktopAuthentication(command: string): string | null {
  for (const segment of splitCommand(command).map(parseSegment)) {
    const program = path.basename(segment.program);
    if (program === 'pkexec') return 'pkexec opens a desktop authentication window';
    if (program === 'sudo' && segment.args.some((arg) => arg === '--askpass' || /^-[a-zA-Z]*A/.test(arg))) return 'sudo -A uses a graphical askpass helper';
  }
  return null;
}

/** A child sharing our controlling TTY must never signal our own process group. */
export function descendantPids(pid: number): number[] {
  const result = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8', timeout: 1000 });
  const pairs = (result.stdout ?? '').trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number));
  const found = new Set([pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [child, parent] of pairs) {
      if (child > 0 && child !== process.pid && found.has(parent) && !found.has(child)) { found.add(child); changed = true; }
    }
  }
  return [...found].reverse();
}
