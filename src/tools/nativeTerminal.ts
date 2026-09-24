import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseSegment, splitCommand } from '../permissions/bashParser.js';

/** The UI owns terminal input outside this callback; the child owns it inside. */
/** Run `run` with the terminal handed over; `banner` replaces the default authentication line. */
export type RunInTerminal = <T>(run: () => Promise<T>, banner?: string) => Promise<T>;

export function needsNativeTerminal(command: string): boolean {
  return splitCommand(command).map(parseSegment).some((segment) => path.basename(segment.program) === 'sudo');
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
