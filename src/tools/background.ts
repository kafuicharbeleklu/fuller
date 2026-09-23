import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { CONFIG_DIR_NAME } from '../branding.js';
import { truncateMiddle } from './truncate.js';

export type BackgroundStatus = 'running' | 'completed' | 'failed' | 'killed' | 'timed_out';

export interface BackgroundTask {
  id: string;
  command: string;
  description?: string;
  status: BackgroundStatus;
  exitCode?: number;
  startedAt: number;
  endedAt?: number;
  logFile: string;
  /** Bytes of output already reported to the model. */
  reportedBytes: number;
  child?: ChildProcess;
}

const MAX_LOG = 50 * 1024 * 1024;

/** Runs shell commands detached from the conversation turn; output goes to a log file. */
export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>();
  private counter = 0;
  private dir: string;

  constructor(private readonly cwd: string, sessionId: string, private readonly onFinish?: (task: BackgroundTask, tail: string) => void) {
    this.dir = path.join(os.homedir(), CONFIG_DIR_NAME, 'tasks', sessionId);
  }

  public start(command: string, options: { description?: string; timeoutMs?: number } = {}): BackgroundTask {
    fs.mkdirSync(this.dir, { recursive: true });
    const id = `bg${++this.counter}`;
    const logFile = path.join(this.dir, `${id}.log`);
    const out = fs.openSync(logFile, 'w');
    const child = spawn('/bin/bash', ['-c', command], {
      cwd: this.cwd,
      env: { ...process.env, FULLER: '1', FULLER_BACKGROUND: '1', TERM: 'dumb', GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', out, out],
      detached: process.platform !== 'win32',
    });
    fs.closeSync(out);
    const task: BackgroundTask = { id, command, description: options.description, status: 'running', startedAt: Date.now(), logFile, reportedBytes: 0, child };
    this.tasks.set(id, task);
    const timer = options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => { if (task.status === 'running') { task.status = 'timed_out'; this.killTree(task, 'SIGTERM'); } }, options.timeoutMs)
      : null;
    child.on('error', (err) => {
      try { fs.appendFileSync(logFile, `\n[spawn error] ${err.message}\n`); } catch {}
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      task.endedAt = Date.now();
      task.exitCode = code ?? 1;
      if (task.status === 'running') task.status = code === 0 ? 'completed' : 'failed';
      task.child = undefined;
      this.onFinish?.(task, this.tail(task, 2000));
    });
    child.unref();
    return task;
  }

  private killTree(task: BackgroundTask, signal: NodeJS.Signals) {
    const child = task.child;
    if (!child?.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {}
    setTimeout(() => { try { if (child.pid && task.status !== 'completed') process.kill(-child.pid, 'SIGKILL'); } catch {} }, 2000).unref();
  }

  public kill(id: string): BackgroundTask | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    if (task.status === 'running') {
      task.status = 'killed';
      this.killTree(task, 'SIGTERM');
    }
    return task;
  }

  public killAll(): void {
    for (const t of this.tasks.values()) if (t.status === 'running') this.kill(t.id);
  }

  public get(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  public list(): BackgroundTask[] {
    return [...this.tasks.values()];
  }

  public running(): number {
    return this.list().filter((t) => t.status === 'running').length;
  }

  public tail(task: BackgroundTask, bytes: number): string {
    try {
      const stat = fs.statSync(task.logFile);
      const start = Math.max(0, stat.size - bytes);
      const fd = fs.openSync(task.logFile, 'r');
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      return buf.toString('utf8');
    } catch {
      return '';
    }
  }

  /** Read new output since the last read (or from `offset`). */
  public read(id: string, offset?: number): { task: BackgroundTask; output: string; nextOffset: number } | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    let stat;
    try { stat = fs.statSync(task.logFile); } catch { return { task, output: '', nextOffset: 0 }; }
    const from = Math.min(offset ?? task.reportedBytes, stat.size);
    const length = Math.min(stat.size - from, MAX_LOG);
    let output = '';
    if (length > 0) {
      const fd = fs.openSync(task.logFile, 'r');
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, from);
      fs.closeSync(fd);
      output = buf.toString('utf8');
    }
    task.reportedBytes = from + length;
    return { task, output: truncateMiddle(output, 30_000), nextOffset: task.reportedBytes };
  }

  /** Wait until the task finishes or the timeout elapses. */
  public async wait(id: string, timeoutMs: number): Promise<BackgroundTask | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    const end = Date.now() + timeoutMs;
    while (task.status === 'running' && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
    return task;
  }
}

export function describeTask(t: BackgroundTask): string {
  const dur = Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 1000);
  return `${t.id} · ${t.status}${t.exitCode !== undefined ? ` (exit ${t.exitCode})` : ''} · ${dur}s · ${t.description ?? t.command.split('\n')[0].slice(0, 80)}`;
}
