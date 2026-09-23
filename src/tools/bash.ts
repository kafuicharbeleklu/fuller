import { spawn } from 'node:child_process';

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  interrupted: boolean;
  durationMs: number;
}

const MAX_CAPTURE = 5 * 1024 * 1024;

export function executeBash(
  command: string,
  cwd: string,
  options: { timeoutMs?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv; onOutput?: (chunk: string) => void } = {}
): Promise<BashResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const start = Date.now();
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let interrupted = false;
    let settled = false;

    const child = spawn('/bin/bash', ['-c', command], {
      cwd,
      env: { ...process.env, ...options.env, FULLER: '1', TERM: process.env.TERM || 'xterm-256color', GIT_TERMINAL_PROMPT: '0', CI: process.env.CI ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    const killTree = (sig: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {}
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 2000).unref();
    }, timeoutMs);

    const onAbort = () => {
      interrupted = true;
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 1500).unref();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (d: Buffer) => {
      const s = d.toString('utf8');
      if (stdout.length < MAX_CAPTURE) stdout += s;
      options.onOutput?.(s);
    });
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString('utf8');
      if (stderr.length < MAX_CAPTURE) stderr += s;
      options.onOutput?.(s);
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        exitCode: code ?? (timedOut || interrupted ? 124 : 1),
        timedOut,
        interrupted,
        durationMs: Date.now() - start,
      });
    };

    child.on('error', (err) => {
      stderr += `\n${err.message}`;
      finish(127);
    });
    child.on('close', (code) => finish(code));
  });
}
