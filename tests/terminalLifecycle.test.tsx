import React from 'react';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink';
import xterm from '@xterm/headless';
import type { AgentCallbacks } from '../src/agent/loop.js';
import type { ToolCallState } from '../src/agent/types.js';
import { installFrameWriter } from '../src/ui/frameWriter.js';
import { getConfig } from '../src/config.js';
import { App } from '../src/ui/App.js';
import { evaluatePermission } from '../src/permissions/rules.js';

let callbacks: AgentCallbacks;
vi.mock('../src/agent/loop.js', () => ({
  AgentLoop: class {
    sessionId = 'terminal-test';
    constructor(_config: unknown, cb: AgentCallbacks) { callbacks = cb; }
    getSkills() { return []; }
    getTodos() { return []; }
    setContextWindow() {}
    setGitBranch() {}
  },
}));
vi.mock('../src/utils/git.js', () => ({ getGitInfo: async () => ({ isGit: false }) }));
vi.mock('../src/agent/contextLoader.js', () => ({ loadProjectContext: () => [] }));
vi.mock('../src/session/history.js', () => ({ loadPromptHistory: () => [], loadPromptTimes: () => new Map() }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).reverse().forEach((cleanup) => cleanup()); });

async function terminalApp(columns: number, rows: number, fullscreen = false) {
  const chunks: string[] = [];
  const stdout = Object.assign(new Writable({ write(chunk, _encoding, done) { chunks.push(chunk.toString()); done(); } }), { isTTY: true, columns, rows });
  const inkStdout = new Proxy(stdout, {
    get(target, prop, receiver) {
      if (prop === 'columns') return columns - 1;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const writer = installFrameWriter(stdout as any, { syncOutput: false });
  const config = getConfig({ apiKey: 'test-only', workspaceDir: '/tmp/fuller-terminal-fixture' });
  config.notifications = 'off';
  config.permissionMode = 'default';
  config.model = 'gemini-3.6-flash';
  config.thinkingLevel = 'medium';
  config.settings = { theme: 'dark', spinnerVerbs: ['Working'] };
  const app = render(<App config={config} frameWriter={writer} fullscreen={fullscreen} />, { stdout: inkStdout as any, stdin: stdin as any, stderr: stdout as any, exitOnCtrlC: false, patchConsole: false });
  cleanups.push(() => { app.unmount(); app.cleanup(); writer.restore(); });
  await settle();
  const initialChunks = chunks.length;
  return async () => {
    await settle();
    expect(chunks.slice(initialChunks).join('')).not.toContain('\x1b[2J');
    const terminal = new xterm.Terminal({ cols: columns, rows, scrollback: 10000, convertEol: true, allowProposedApi: true });
    await new Promise<void>((resolve) => terminal.write(chunks.join(''), resolve));
    const buffer = terminal.buffer.active;
    const text = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)!.translateToString(true)).join('\n');
    terminal.dispose();
    return text;
  };
}


/** The permission dialog starts at its top rule, the last full line of `─`. */
const permissionCard = (screen: string) => screen.slice(screen.search(/^─+$(?![\s\S]*^─+$)/m)).trimEnd();

describe('terminal lifecycle (screen and scrollback replay)', () => {
  it.each([[60, 12], [60, 16], [80, 24]])('fits a permission card in fullscreen at %ix%i', async (columns, rows) => {
    const replay = await terminalApp(columns, rows, true);
    const tool: ToolCallState = { id: 'fullscreen-t', name: 'execute_bash', args: { command: 'sudo ip link set tun0 down && sudo ip link set tun1 down', description: 'Bring down VPN tunnel interfaces' }, status: 'confirming' };
    callbacks.onLive({ text: '', tools: [tool] });
    callbacks.onStatusChange('awaiting_permission');
    const approval = evaluatePermission(tool.name, tool.args, '/tmp/fuller-terminal-fixture', 'default', {});
    callbacks.onRequestConfirmation({ toolCall: tool, title: approval.title, danger: approval.danger, note: approval.note, options: approval.options, onDecide() {} });
    const permission = await replay();
    expect(permission).toContain('Bash command');
    if (rows >= 24) {
      expect(permission).toContain('Bash(');
    }
    expect(permission).not.toContain('execute_bash');
    expect(permission).toContain('sudo ip link set tun0 down');
    expect(permission).not.toMatch(/^❯\s*$/m);
    expect(permissionCard(permission)).toMatchSnapshot();
    callbacks.onRequestConfirmation(null);
    callbacks.onLive(null);
    callbacks.onStatusChange('idle');
    const final = await replay();
    expect(final).not.toContain('Bash command');
    expect(final).not.toContain('Waiting for permission');
  });

  it.each([[126, 35], [80, 24], [60, 16], [60, 12]])('removes permission and retry frames at %ix%i', async (columns, rows) => {
    const replay = await terminalApp(columns, rows);
    callbacks.onCommit({ key: 'u1', kind: 'user', message: { id: 'u1', content: 'Run a simulated command', role: 'user', timestamp: 0 } });
    callbacks.onStatusChange('thinking');
    await settle();
    const tool: ToolCallState = { id: 't1', name: 'execute_bash', args: { command: 'sudo printf RESULT_UNIQUE', description: 'Run a simulated privileged command' }, status: 'confirming' };
    callbacks.onLive({ text: '', tools: [tool] });
    callbacks.onStatusChange('awaiting_permission');
    const pending = await replay();
    expect(pending).toContain('Waiting for permission');
    expect(pending).not.toMatch(/^❯\s*$/m);
    const approval = evaluatePermission(tool.name, tool.args, '/tmp/fuller-terminal-fixture', 'default', {});
    callbacks.onRequestConfirmation({ toolCall: tool, title: approval.title, danger: approval.danger, note: approval.note, options: approval.options, onDecide() {} });
    const permission = await replay();
    expect(permission).toContain('Bash command');
    expect(permission).toContain('sudo printf RESULT_UNIQUE');
    expect(permission.match(/Waiting for permission/g) ?? []).toHaveLength(0);
    if (rows >= 20) expect(permission).toContain('Running…');
    expect(permission).not.toMatch(/^❯\s*$/m);
    expect(permissionCard(permission)).toMatchSnapshot();
    callbacks.onRequestConfirmation(null);
    callbacks.onLive(null);
    callbacks.onStatusChange('running_tool');
    callbacks.onCommit({ key: 't1', kind: 'tool', messageId: 'a1', toolCall: { ...tool, status: 'completed', result: 'RESULT_UNIQUE' } });
    callbacks.onStatusChange('thinking');
    callbacks.onNotice({ level: 'warn', text: 'API Error (429) · Retrying in 8 seconds… (attempt 4/5)' });
    await settle();
    callbacks.onCommit({ key: 'e1', kind: 'system', message: { id: 'e1', content: 'FINAL_ERROR_UNIQUE', role: 'system', timestamp: 0 } });
    callbacks.onNotice(null);
    callbacks.onLive(null);
    callbacks.onStatusChange('idle');
    const final = await replay();
    expect(final).not.toMatch(/Waiting for permission|Do you want|Retrying|esc to interrupt/);
    expect(final.match(/FINAL_ERROR_UNIQUE/g)).toHaveLength(1);
    // The command header contains RESULT_UNIQUE as well as its output.
    expect(final.match(/RESULT_UNIQUE/g)).toHaveLength(2);
    expect(final.match(/^❯\s*$/gm)).toHaveLength(1);
    expect(final.slice(final.indexOf('❯ Run a simulated command')).trimEnd()).toMatchSnapshot();
  });

  it('keeps a streamed answer out of scrollback when committing it', async () => {
    const replay = await terminalApp(60, 16);
    callbacks.onStatusChange('streaming');
    callbacks.onLive({ text: 'STREAMED_UNIQUE\n' + 'A long response. '.repeat(150), tools: [] });
    await settle();
    callbacks.onCommit({ key: 'a1', kind: 'text', messageId: 'a1', content: 'STREAMED_UNIQUE\n' + 'A long response. '.repeat(150), timestamp: 0 });
    callbacks.onLive(null);
    callbacks.onStatusChange('idle');
    const final = await replay();
    expect(final.match(/STREAMED_UNIQUE/g)).toHaveLength(1);
    expect(final.replace(/\s/g, '').match(/Alongresponse\./g)).toHaveLength(150);
    expect(final.match(/^❯\s*$/gm)).toHaveLength(1);
  });
});
