import React from 'react';
import { PassThrough, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink';
import type { AgentCallbacks } from '../src/agent/loop.js';

let callbacks: AgentCallbacks;
vi.mock('../src/agent/loop.js', () => ({
  AgentLoop: class {
    sessionId = 'diff-auto-test';
    constructor(_config: unknown, cb: AgentCallbacks) { callbacks = cb; }
    getSkills() { return []; }
    getTodos() { return []; }
    setContextWindow() {}
    setGitBranch() {}
    sessionEditedFiles() { return ['a.txt']; }
    addCommandMessage() {}
  },
}));
vi.mock('../src/agent/contextLoader.js', () => ({ loadProjectContext: () => [] }));
vi.mock('../src/session/history.js', () => ({ loadPromptHistory: () => [], loadPromptTimes: () => new Map() }));

import { getConfig } from '../src/config.js';
import { App } from '../src/ui/App.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 250));
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).reverse().forEach((c) => { try { c(); } catch {} }); });

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-diff-auto-'));
  cleanups.push(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
  return dir;
}

async function app(columns: number, preference?: 'opened' | 'closed') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-diff-home-'));
  process.env.HOME = home;
  cleanups.push(() => { fs.rmSync(home, { recursive: true, force: true }); });
  const chunks: string[] = [];
  const stdout = Object.assign(new Writable({ write(chunk, _e, done) { chunks.push(chunk.toString()); done(); } }), { isTTY: true, columns, rows: 40 });
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const config = getConfig({ apiKey: 'test-only', workspaceDir: repo() });
  config.notifications = 'off';
  config.settings = { theme: 'dark', ...(preference ? { diffPanel: preference } : {}) };
  const instance = render(<App config={config} fullscreen />, { stdout: stdout as any, stdin: stdin as any, stderr: stdout as any, exitOnCtrlC: false, patchConsole: false });
  cleanups.push(() => { instance.unmount(); instance.cleanup(); });
  await settle();
  return {
    config,
    edit: async (name = 'edit_file') => {
      callbacks.onCommit({ key: `t${Math.random()}`, kind: 'tool', messageId: 'm', toolCall: { id: 't', name, args: { file_path: 'a.txt' }, status: 'completed', startTime: 0 } } as any);
      await settle();
    },
    panelShown: () => chunks.join('').includes('1 file changed'),
  };
}

describe('the diff panel opens on its own, as Claude Code documents it', () => {
  it('opens at the first edit from 144 columns', async () => {
    const run = await app(150);
    expect(run.panelShown()).toBe(false);
    await run.edit();
    expect(run.panelShown()).toBe(true);
  });

  it('does not open on its own below 144 columns until /diff has been used, then from 110', async () => {
    const narrow = await app(120);
    await narrow.edit();
    expect(narrow.panelShown()).toBe(false);
    const used = await app(120, 'opened');
    await used.edit();
    expect(used.panelShown()).toBe(true);
  });

  it('stays closed once closed, and ignores shell commands for opening', async () => {
    const closed = await app(150, 'closed');
    await closed.edit();
    expect(closed.panelShown()).toBe(false);
    const shell = await app(150);
    await shell.edit('execute_bash');
    expect(shell.panelShown()).toBe(false);
  });
});
