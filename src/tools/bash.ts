import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { BackgroundTaskManager } from './background.js';
import { descendantPids, needsNativeTerminal, type RunInTerminal } from './nativeTerminal.js';

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  interrupted: boolean;
  durationMs: number;
  /** Complete, untruncated output in arrival order, when capture was requested. */
  outputFile?: string;
  backgroundTaskId?: string;
}

export type BackgroundReady = (move: (() => string | undefined) | undefined) => void;

const MAX_CAPTURE = 5 * 1024 * 1024;

export interface BashOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  onOutput?: (chunk: string) => void;
  outputFile?: string;
  background?: BackgroundTaskManager;
  onBackgroundReady?: BackgroundReady;
  runInTerminal?: RunInTerminal;
}

export function executeBash(command: string, cwd: string, options: BashOptions = {}): Promise<BashResult> {
  if (options.runInTerminal && needsNativeTerminal(command)) {
    return options.runInTerminal(() => runBash(command, cwd, options, true));
  }
  return runBash(command, cwd, options, false);
}

function runBash(
  command: string,
  cwd: string,
  options: BashOptions,
  nativeTerminal: boolean,
): Promise<BashResult> {
  if (options.signal?.aborted) return Promise.reject(new Error('Interrupted'));
  const timeoutMs = options.timeoutMs ?? 120_000;
  const start = Date.now();
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let interrupted = false;
    let settled = false;
    let backgrounded = false;
    let registered = false;
    let outputFd: number | undefined;
    let outputFile = options.outputFile;
    let outputWriteError: string | undefined;
    if (options.outputFile) {
      fs.mkdirSync(path.dirname(options.outputFile), { recursive: true });
      outputFd = fs.openSync(options.outputFile, 'w', 0o600);
    }

    let child;
    try { child = spawn('/bin/bash', ['-c', command], {
      cwd,
      env: { ...process.env, ...options.env, FULLER: '1', TERM: process.env.TERM || 'xterm-256color', GIT_TERMINAL_PROMPT: '0', CI: process.env.CI ?? '' },
      stdio: [nativeTerminal ? 'inherit' : 'ignore', 'pipe', 'pipe'],
      detached: !nativeTerminal && process.platform !== 'win32',
    }); } catch (error) {
      if (outputFd !== undefined) fs.closeSync(outputFd);
      reject(error);
      return;
    }

    const persistOutput = (chunk: Buffer) => {
      if (outputFd === undefined) return;
      try {
        let offset = 0;
        while (offset < chunk.length) {
          const written = fs.writeSync(outputFd, chunk, offset, chunk.length - offset);
          if (!written) throw new Error('Zero-byte write');
          offset += written;
        }
      }
      catch (error: any) {
        outputWriteError = error.message || String(error);
        try { fs.closeSync(outputFd); } catch {}
        outputFd = undefined;
        outputFile = undefined;
      }
    };

    let descendants: number[] | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const killTree = (sig: NodeJS.Signals) => {
      if (nativeTerminal && child.pid) {
        descendants ??= descendantPids(child.pid);
        for (const pid of descendants) { try { process.kill(pid, sig); } catch {} }
        return;
      }
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {}
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      killTimer = setTimeout(() => killTree('SIGKILL'), 2000);
      killTimer.unref();
    }, timeoutMs);

    const onAbort = () => {
      interrupted = true;
      killTree('SIGTERM');
      killTimer = setTimeout(() => killTree('SIGKILL'), 1500);
      killTimer.unref();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    child.stdout?.on('data', (d: Buffer) => {
      persistOutput(d);
      const s = d.toString('utf8');
      if (stdout.length < MAX_CAPTURE) stdout += s;
      if (!backgrounded) options.onOutput?.(s);
    });
    child.stderr?.on('data', (d: Buffer) => {
      persistOutput(d);
      const s = d.toString('utf8');
      if (stderr.length < MAX_CAPTURE) stderr += s;
      if (!backgrounded) options.onOutput?.(s);
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (registered) { registered = false; options.onBackgroundReady?.(undefined); }
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
      if (outputFd !== undefined) { fs.closeSync(outputFd); outputFd = undefined; }
      if (outputWriteError) stderr += `\n[Fuller could not save the complete output: ${outputWriteError}]`;
      resolve({
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        exitCode: code ?? (timedOut || interrupted ? 124 : 1),
        timedOut,
        interrupted,
        durationMs: Date.now() - start,
        outputFile,
      });
    };

    child.on('error', (err) => {
      stderr += `\n${err.message}`;
      finish(127);
    });
    child.on('close', (code) => finish(code));
    if (!nativeTerminal && options.background && outputFile && !interrupted) {
      registered = true;
      options.onBackgroundReady?.(() => {
        if (settled || interrupted || timedOut || backgrounded || !outputFile) return;
        backgrounded = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        const task = options.background!.adopt(command, child, outputFile, start);
        registered = false;
        options.onBackgroundReady?.(undefined);
        resolve({ stdout, stderr, exitCode: 0, timedOut: false, interrupted: false, durationMs: Date.now() - start, outputFile, backgroundTaskId: task.id });
        return task.id;
      });
    }
  });
}
