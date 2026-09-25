import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeBash } from '../src/tools/bash.js';
import { BackgroundTaskManager } from '../src/tools/background.js';

describe('background tasks', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-bg-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-bg-home-'));
  process.env.HOME = home;
  afterAll(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('starts, streams to a log, reads incrementally and notifies on completion', async () => {
    const finished: string[] = [];
    const mgr = new BackgroundTaskManager(cwd, 'sess', (t) => finished.push(`${t.id}:${t.status}:${t.exitCode}`));
    const task = mgr.start('echo one; sleep 0.3; echo two; exit 3', { description: 'demo' });
    expect(task.id).toBe('bg1');
    expect(mgr.running()).toBe(1);
    await new Promise((r) => setTimeout(r, 150));
    const first = mgr.read('bg1')!;
    expect(first.output).toContain('one');
    expect(first.task.status).toBe('running');
    await mgr.wait('bg1', 3000);
    const second = mgr.read('bg1')!;
    expect(second.output).toContain('two');
    expect(second.output).not.toContain('one');
    expect(second.task.status).toBe('failed');
    expect(second.task.exitCode).toBe(3);
    expect(finished).toEqual(['bg1:failed:3']);
    expect(fs.existsSync(task.logFile)).toBe(true);
  });

  it('adopts a foreground process once, keeps all output, and detaches it from the turn signal', async () => {
    const finished: string[] = [];
    const mgr = new BackgroundTaskManager(cwd, 'adopt', (task) => finished.push(task.id));
    const controller = new AbortController();
    let move: (() => string | undefined) | undefined;
    let ready!: () => void;
    const outputReady = new Promise<void>((resolve) => { ready = resolve; });
    const outputFile = path.join(cwd, 'adopt.log');
    const countFile = path.join(cwd, 'started.log');
    const result = executeBash(`echo start >> '${countFile}'; echo before; sleep 0.4; echo after`, cwd, {
      outputFile, signal: controller.signal, background: mgr,
      onBackgroundReady: (value) => { move = value; }, onOutput: () => ready(),
    });
    try {
      await outputReady;
      const transfer = move!;
      expect(transfer()).toBe('bg1');
      expect(transfer()).toBeUndefined();
      const res = await result;
      expect(res.backgroundTaskId).toBe('bg1');
      expect(move).toBeUndefined();
      controller.abort();
      await mgr.wait('bg1', 3000);
      expect(mgr.get('bg1')?.status).toBe('completed');
      expect(fs.readFileSync(outputFile, 'utf8')).toBe('before\nafter\n');
      expect(fs.readFileSync(countFile, 'utf8')).toBe('start\n');
      expect(finished).toEqual(['bg1']);
    } finally { mgr.killAll(); controller.abort(); }
  });

  it('kills a running task', async () => {
    const mgr = new BackgroundTaskManager(cwd, 'sess2');
    mgr.start('sleep 30');
    const t = mgr.kill('bg1')!;
    expect(t.status).toBe('killed');
    await mgr.wait('bg1', 3000);
    expect(mgr.running()).toBe(0);
  });

  it('honours the timeout', async () => {
    const mgr = new BackgroundTaskManager(cwd, 'sess3');
    mgr.start('sleep 30', { timeoutMs: 200 });
    const t = await mgr.wait('bg1', 3000);
    expect(t?.status).toBe('timed_out');
  });
});
