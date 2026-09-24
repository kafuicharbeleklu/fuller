import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const calls: any[] = [];
let oneShotReply = '';
let script: Array<{ text?: string; functionCalls?: any[]; error?: Error; retry?: boolean }> = [];

vi.mock('../src/agent/gemini.js', () => {
  class GeminiAgentSession {
    constructor(public config: any) {}
    setGitBranch() {}
    setSkills() {}
    setExtraTools() {}
    setToolFilter() {}
    setExtraInstructions() {}
    setSubagents() {}
    initChat() {}
    refresh() {}
    getHistory() { return []; }
    repairHistory() {}
    resetWithSummary() {}
    switchModel() {}
    chainMinWindow() { return 1_048_576; }
    quotaUsage() { return { model: 'm', keys: 1, exhausted: 0, refused: 0, usedFraction: 0, overloaded: false }; }
    async sendUserMessage(text: any, opts: any) {
      calls.push({ kind: 'user', text: typeof text === 'string' ? text : text.map((p: any) => p.text ?? `[inline ${p.inlineData?.mimeType} ${p.inlineData?.data?.length}]`).join(''), parts: typeof text === 'string' ? undefined : text });
      return this.next(opts);
    }
    async sendToolResponses(responses: any[], opts: any) {
      calls.push({ kind: 'tools', responses });
      return this.next(opts);
    }
    private async next(opts: any) {
      const step = script.shift() ?? { text: 'done' };
      opts?.onAttempt?.();
      if (step.retry) opts?.onRetry?.({ attempt: 4, maxAttempts: 5, delayMs: 8000, status: 429 });
      if (step.text) opts?.onChunk?.(step.text);
      if (step.error) throw step.error;
      return { text: step.text ?? '', functionCalls: step.functionCalls ?? [], usage: { promptTokens: 10, responseTokens: 5, totalTokens: 15, thoughtsTokens: 0 } };
    }
    async compactHistory() { return 'summary'; }
    async oneShot(question: string) { calls.push({ kind: 'oneShot', text: question }); return oneShotReply; }
  }
  class QuotaExhaustedError extends Error {}
  return { GeminiAgentSession, QuotaExhaustedError, historyToText: () => '', sanitizeHistory: (h: any) => h };
});

import { AgentLoop, type AgentCallbacks } from '../src/agent/loop.js';
import { getConfig } from '../src/config.js';

function makeCallbacks(overrides: Partial<AgentCallbacks> = {}) {
  const items: any[] = [];
  const cb: AgentCallbacks = {
    onStatusChange: () => {},
    onCommit: (i) => items.push(i),
    onLive: () => {},
    onRequestConfirmation: () => {},
    onUsage: () => {},
    onNotice: () => {},
    onQueueChange: () => {},
    ...overrides,
  };
  return { cb, items };
}

describe('AgentLoop', () => {
  let cwd: string;
  beforeEach(() => {
    calls.length = 0;
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-loop-'));
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'hello\n');
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-home-'));
  });

  it('clears retry and live state before committing the final quota error', async () => {
    script = [{ retry: true, error: Object.assign(new Error('Quota reached'), { status: 429 }) }];
    let status = 'idle';
    let notice: unknown = null;
    let live: unknown = null;
    const atError: unknown[] = [];
    const { cb } = makeCallbacks({
      onStatusChange: (value) => { status = value; },
      onNotice: (value) => { notice = value; },
      onLive: (value) => { live = value; },
      onCommit: (item) => {
        if (item.kind === 'system' && item.message.content.includes('API Error')) atError.push({ status, notice, live });
      },
    });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    await loop.handleUserInput('hello');
    expect(atError).toEqual([{ status: 'idle', notice: null, live: null }]);
    expect(loop.busy).toBe(false);
  });

  it('forks a /btw question into a background agent and hands its report to the model', async () => {
    script = [{ text: 'pong report' }, { text: 'main reply' }];
    const { cb, items } = makeCallbacks();
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    loop.forkAside('reply with pong');
    for (let i = 0; i < 50 && !items.some((item) => item.kind === 'text' && item.content === 'main reply'); i++) await new Promise((r) => setTimeout(r, 10));
    const system = items.filter((item) => item.kind === 'system').map((item) => item.message.content);
    expect(system.some((text) => /^\{\{text:⑂ forked reply-with-pong \([0-9a-f]{4}\)\}\}$/.test(text))).toBe(true);
    expect(system.some((text) => text.includes('Agent "reply with pong" finished'))).toBe(true);
    expect(calls[0].text).toBe('reply with pong');
    expect(calls[1].text).toContain('pong report');
    // The report reaches the model without appearing as a user message.
    expect(items.filter((item) => item.kind === 'user').map((item) => item.message.content)).toEqual(['/btw reply with pong']);
    expect(items.some((item) => item.kind === 'text' && item.content === 'main reply')).toBe(true);
  });

  it('has the model answer a ! command, as Claude Code does', async () => {
    script = [{ text: 'The command printed hi-bang.' }];
    const { cb, items } = makeCallbacks();
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    await loop.runShell('echo hi-bang');
    for (let i = 0; i < 50 && !items.some((item) => item.kind === 'text'); i++) await new Promise((r) => setTimeout(r, 10));
    expect(calls[0].text).toContain('The user ran this shell command themselves: `echo hi-bang`');
    expect(calls[0].text).toContain('hi-bang');
    expect(items.filter((item) => item.kind === 'user').map((item) => item.message.content)).toEqual(['echo hi-bang']);
    expect(items.some((item) => item.kind === 'text' && item.content === 'The command printed hi-bang.')).toBe(true);
  });

  it('keeps a ! command for the next prompt when replies after shell commands are off', async () => {
    const { cb } = makeCallbacks();
    const config = getConfig({ workspaceDir: cwd, apiKey: 'x' });
    config.settings.replyAfterShell = false;
    const loop = new AgentLoop(config, cb);
    await loop.runShell('echo quiet-bang');
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(0);
  });

  it('lets the auto mode classifier allow or deny instead of asking', async () => {
    const asked: unknown[] = [];
    const { cb, items } = makeCallbacks({ onRequestConfirmation: (c) => { if (c) asked.push(c); } });
    const config = getConfig({ workspaceDir: cwd, apiKey: 'x', permissionMode: 'auto' });
    const loop = new AgentLoop(config, cb);
    oneShotReply = '{"decision": "deny", "reason": "git push was not requested"}';
    script = [{ functionCalls: [{ name: 'execute_bash', args: { command: 'git push origin main' } }] }, { text: 'ok' }];
    await loop.handleUserInput('tidy up');
    expect(asked).toHaveLength(0);
    expect(calls.find((c) => c.kind === 'oneShot')?.text).toContain('Action: Bash(git push origin main)');
    expect(calls.find((c) => c.kind === 'tools').responses[0].output).toContain('auto mode denied this tool call: git push was not requested');
    expect(loop.getRecentDenials()[0]).toMatchObject({ action: 'Bash(git push origin main)', reason: 'git push was not requested' });
    const tool = items.find((item) => item.kind === 'tool');
    expect(tool.toolCall.error).toBe('Denied by auto mode · git push was not requested');

    calls.length = 0;
    oneShotReply = '{"decision": "allow", "reason": "tests are part of the task"}';
    script = [{ functionCalls: [{ name: 'execute_bash', args: { command: 'echo auto-ok' } }] }, { text: 'done' }];
    await loop.handleUserInput('run it');
    expect(asked).toHaveLength(0);
    expect(calls.find((c) => c.kind === 'tools').responses[0].output).toContain('auto-ok');
    oneShotReply = '';
  });

  it('refuses to edit a file it has not read, or that changed since it was read', async () => {
    script = [
      { functionCalls: [{ id: '1', name: 'edit_file', args: { file_path: 'a.txt', target_content: 'hello', replacement_content: 'bye' } }] },
      { functionCalls: [{ id: '2', name: 'read_file', args: { file_path: 'a.txt' } }] },
      { functionCalls: [{ id: '3', name: 'edit_file', args: { file_path: 'a.txt', target_content: 'hello', replacement_content: 'bye' } }] },
      { text: 'done' },
    ];
    const asked: unknown[] = [];
    const { cb } = makeCallbacks({ onRequestConfirmation: (c) => { if (c) { asked.push(c); c.onDecide({ kind: 'yes' }); } } });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    await loop.handleUserInput('edit it');
    const outputs = calls.filter((c) => c.kind === 'tools').map((c) => c.responses[0].output);
    expect(outputs[0]).toContain('File has not been read yet. Read it first before writing to it.');
    // No permission prompt for the refused edit, one for the valid one.
    expect(asked).toHaveLength(1);
    expect(fs.readFileSync(path.join(cwd, 'a.txt'), 'utf8')).toBe('bye\n');

    // Someone else changes the file: the agent must read it again.
    calls.length = 0;
    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'bye from the user\n');
    fs.utimesSync(path.join(cwd, 'a.txt'), later, later);
    script = [{ functionCalls: [{ id: '4', name: 'edit_file', args: { file_path: 'a.txt', target_content: 'bye', replacement_content: 'ciao' } }] }, { text: 'done' }];
    await loop.handleUserInput('edit again');
    expect(calls.find((c) => c.kind === 'tools').responses[0].output).toContain('File has been modified since read');
    expect(fs.readFileSync(path.join(cwd, 'a.txt'), 'utf8')).toBe('bye from the user\n');
  });

  it('waits for permission before handing sudo to the terminal', async () => {
    script = [{ functionCalls: [{ name: 'execute_bash', args: { command: 'sudo simulated' } }] }, { text: 'done' }];
    const order: string[] = [];
    const { cb } = makeCallbacks({
      onRequestConfirmation: (confirmation) => {
        if (confirmation) { order.push('permission'); confirmation.onDecide({ kind: 'yes' }); }
      },
      runInTerminal: async () => {
        order.push('terminal');
        // Do not invoke the supplied action: this test never runs real sudo.
        return { stdout: 'simulated result', stderr: '', exitCode: 0, timedOut: false, interrupted: false, durationMs: 1 } as any;
      },
    });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    await loop.handleUserInput('test approval');
    expect(order).toEqual(['permission', 'terminal']);
    expect(calls[1].responses[0].output).toContain('simulated result');
  });

  it('does not acquire the terminal after a refused sudo command', async () => {
    script = [{ functionCalls: [{ name: 'execute_bash', args: { command: 'sudo simulated' } }] }];
    const terminal = vi.fn();
    const { cb } = makeCallbacks({
      onRequestConfirmation: (confirmation) => confirmation?.onDecide({ kind: 'no' }),
      runInTerminal: terminal,
    });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    await loop.handleUserInput('test refusal');
    expect(terminal).not.toHaveBeenCalled();
  });

  it('records a local model command without sending it to Gemini', () => {
    const { cb, items } = makeCallbacks();
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    loop.addCommandMessage('/model');
    expect(items.at(-1)).toMatchObject({ kind: 'user', message: { role: 'user', content: '/model', kind: 'command' } });
    expect(loop.getMessages().at(-1)).toMatchObject({ role: 'user', content: '/model', kind: 'command' });
    expect(calls).toHaveLength(0);
  });

  it('answers parallel tool calls with one batched response', async () => {
    script = [
      { text: 'Looking.', functionCalls: [{ id: '1', name: 'read_file', args: { file_path: 'a.txt' } }, { id: '2', name: 'list_directory', args: {} }] },
      { text: 'Done.' },
    ];
    const { cb, items } = makeCallbacks();
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    await loop.handleUserInput('read it');
    const toolsCall = calls.find((c) => c.kind === 'tools');
    expect(toolsCall.responses).toHaveLength(2);
    expect(toolsCall.responses.map((r: any) => r.id)).toEqual(['1', '2']);
    expect(toolsCall.responses[0].output).toContain('hello');
    expect(items.filter((i) => i.kind === 'tool')).toHaveLength(2);
    expect(items.filter((i) => i.kind === 'text').map((i) => i.content)).toEqual(['Looking.', 'Done.']);
  });

  it('rewinds code and conversation to a selected prompt without touching earlier edits', async () => {
    // a.txt already exists: the read-before-edit guard wants it read first.
    script = [
      { functionCalls: [{ id: '0', name: 'read_file', args: { file_path: 'a.txt' } }] },
      { functionCalls: [{ id: '1', name: 'write_file', args: { file_path: 'a.txt', content: 'first' } }] },
      { text: 'first done' },
      { functionCalls: [{ id: '2', name: 'write_file', args: { file_path: 'a.txt', content: 'second' } }] },
      { text: 'second done' },
    ];
    const reset = vi.fn();
    const { cb } = makeCallbacks({
      onRequestConfirmation: (confirmation) => confirmation?.onDecide({ kind: 'yes' }),
      onTranscriptReset: reset,
    });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    await loop.handleUserInput('write first');
    await loop.handleUserInput('write second');
    expect(fs.readFileSync(path.join(cwd, 'a.txt'), 'utf8')).toBe('second');
    const second = loop.getTurnCheckpoints()[0];
    const files = loop.rewindTurn(second.id, 'both');
    expect(files).toContain('a.txt');
    expect(fs.readFileSync(path.join(cwd, 'a.txt'), 'utf8')).toBe('first');
    expect(loop.getMessages().some((message) => message.content === 'write second')).toBe(false);
    expect(reset).toHaveBeenCalledOnce();
  });

  it('can restore code while keeping the conversation intact', async () => {
    script = [
      { functionCalls: [{ id: '0', name: 'read_file', args: { file_path: 'a.txt' } }] },
      { functionCalls: [{ id: '1', name: 'write_file', args: { file_path: 'a.txt', content: 'changed' } }] },
      { text: 'done' },
    ];
    const { cb } = makeCallbacks({ onRequestConfirmation: (confirmation) => confirmation?.onDecide({ kind: 'yes' }) });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    await loop.handleUserInput('change file');
    const checkpoint = loop.getTurnCheckpoints()[0];
    expect(loop.rewindTurn(checkpoint.id, 'code')).toContain('a.txt');
    expect(fs.readFileSync(path.join(cwd, 'a.txt'), 'utf8')).toBe('hello\n');
    expect(loop.getMessages().some((message) => message.content === 'change file')).toBe(true);
  });

  it('summarizes only the turns after a selected prompt', async () => {
    script = [{ text: 'first' }, { text: 'second' }];
    const { cb } = makeCallbacks();
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    const session = (loop as any).session;
    let history: any[] = [];
    vi.spyOn(session, 'getHistory').mockImplementation(() => history);
    const init = vi.spyOn(session, 'initChat');
    await loop.handleUserInput('one');
    history = [{ role: 'user', parts: [{ text: 'one' }] }, { role: 'model', parts: [{ text: 'first' }] }];
    await loop.handleUserInput('two');
    history = [...history, { role: 'user', parts: [{ text: 'two' }] }, { role: 'model', parts: [{ text: 'second' }] }];
    await loop.summarizeTurn(loop.getTurnCheckpoints()[0].id, 'from');
    expect(init).toHaveBeenCalledWith([
      history[0], history[1],
      { role: 'user', parts: [{ text: '[Conversation summary]\nsummary' }] },
      { role: 'model', parts: [{ text: 'I will continue from this summary.' }] },
    ]);
  });

  it('denies writes in plan mode without asking', async () => {
    script = [{ functionCalls: [{ name: 'write_file', args: { file_path: 'b.txt', content: 'x' } }] }, { text: 'ok' }];
    const ask = vi.fn();
    const { cb } = makeCallbacks({ onRequestConfirmation: ask });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x', permissionMode: 'plan' }), cb);
    await loop.handleUserInput('write');
    expect(ask).not.toHaveBeenCalledWith(expect.objectContaining({ toolCall: expect.anything() }));
    expect(calls[1].responses[0].output).toMatch(/Plan mode/);
    expect(fs.existsSync(path.join(cwd, 'b.txt'))).toBe(false);
  });

  it('asks for permission, executes on yes and reports feedback on no', async () => {
    script = [
      { functionCalls: [{ name: 'write_file', args: { file_path: 'b.txt', content: 'x' } }] },
      { functionCalls: [{ name: 'execute_bash', args: { command: 'npm test' } }] },
      { text: 'ok' },
    ];
    let n = 0;
    const { cb } = makeCallbacks({
      onRequestConfirmation: (c) => {
        if (!c) return;
        n++;
        if (n === 1) c.onDecide({ kind: 'yes' });
        else c.onDecide({ kind: 'no', feedback: 'use vitest' });
      },
    });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    await loop.handleUserInput('go');
    expect(fs.readFileSync(path.join(cwd, 'b.txt'), 'utf8')).toBe('x');
    expect(calls[2].responses[0].output).toMatch(/declined.*use vitest/);
  });

  it('stops the main turn on a refusal without feedback and does not execute later tools', async () => {
    script = [{ functionCalls: [
      { name: 'write_file', args: { file_path: 'denied.txt', content: 'x' } },
      { name: 'write_file', args: { file_path: 'later.txt', content: 'x' } },
    ] }, { text: 'must not run' }];
    const { cb, items } = makeCallbacks({ onRequestConfirmation: (confirmation) => confirmation?.onDecide({ kind: 'no' }) });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    await loop.handleUserInput('write');
    expect(calls.filter((call) => call.kind === 'tools')).toHaveLength(0);
    expect(fs.existsSync(path.join(cwd, 'denied.txt'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'later.txt'))).toBe(false);
    expect(items.some((item) => item.kind === 'tool' && item.toolCall.status === 'rejected')).toBe(true);
    expect(items.some((item) => item.kind === 'system' && item.message.content.includes('Permission denied'))).toBe(true);
    expect(loop.busy).toBe(false);
  });

  it('delivers an approval comment after the tool result', async () => {
    script = [{ functionCalls: [{ name: 'write_file', args: { file_path: 'approved.txt', content: 'x' } }] }, { text: 'done' }];
    const { cb } = makeCallbacks({ onRequestConfirmation: (confirmation) => confirmation?.onDecide({ kind: 'yes', feedback: 'test this next' }) });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    await loop.handleUserInput('write');
    expect(fs.readFileSync(path.join(cwd, 'approved.txt'), 'utf8')).toBe('x');
    expect(calls[1].responses[0].output).toMatch(/\[User comment on this approval\]\ntest this next$/);
  });

  it('sendNow interrupts the current turn and preserves FIFO prompts and draft attachments', async () => {
    fs.writeFileSync(path.join(cwd, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
    script = [{ functionCalls: [{ name: 'write_file', args: { file_path: 'never.txt', content: 'x' } }] }, { text: 'first queued' }, { text: 'draft response' }];
    let requested!: () => void;
    const permission = new Promise<void>((resolve) => { requested = resolve; });
    const { cb } = makeCallbacks({ onRequestConfirmation: (confirmation) => { if (confirmation) requested(); } });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    const running = loop.handleUserInput('original');
    await permission;
    await loop.handleUserInput('queued');
    await loop.sendNow('draft', [{ n: 1, path: path.join(cwd, 'image.png'), name: 'image.png', mimeType: 'image/png', bytes: 5 }]);
    await running;
    await vi.waitFor(() => expect(calls.filter((call) => call.kind === 'user')).toHaveLength(3));
    expect(calls.filter((call) => call.kind === 'user').map((call) => call.text.split('[inline')[0])).toEqual(['original', 'queued', 'draft']);
    expect(calls.at(-1).parts.some((part: any) => part.inlineData)).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'never.txt'))).toBe(false);
  });

  it('takes queued prompts together while leaving shell commands queued until an empty prompt', async () => {
    script = [{ functionCalls: [{ name: 'write_file', args: { file_path: 'unused.txt', content: 'x' } }] }];
    let requested!: () => void;
    const permission = new Promise<void>((resolve) => { requested = resolve; });
    const { cb } = makeCallbacks({ onRequestConfirmation: (confirmation) => { if (confirmation) requested(); } });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    const running = loop.handleUserInput('original');
    await permission;
    await loop.handleUserInput('one'); await loop.runShell('echo shell'); await loop.handleUserInput('two');
    expect(loop.takeQueue(false)).toEqual({ text: 'one\ntwo', attachments: [], bash: false });
    expect(loop.getQueue()).toEqual(['!echo shell']);
    expect(loop.takeQueue(false)).toBeUndefined();
    expect(loop.takeQueue(true)).toEqual({ text: 'echo shell', attachments: [], bash: true });
    loop.interrupt(); await running;
  });

  it('interrupt rejects a pending confirmation', async () => {
    script = [{ functionCalls: [{ name: 'execute_bash', args: { command: 'npm test' } }] }, { text: 'never' }];
    const { cb, items } = makeCallbacks({
      onRequestConfirmation: (c) => { if (c) setTimeout(() => loop.interrupt(), 5); },
    });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    await loop.handleUserInput('go');
    expect(loop.busy).toBe(false);
    expect(items.some((i) => i.kind === 'system' && /Interrupted/.test(i.message.content))).toBe(true);
    expect(calls.filter((c) => c.kind === 'tools')).toHaveLength(0);
  });

  it('queues prompts sent while busy', async () => {
    script = [{ text: 'first' }, { text: 'second' }];
    const queueStates: string[][] = [];
    const { cb, items } = makeCallbacks({ onQueueChange: (q) => queueStates.push(q) });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    const p1 = loop.handleUserInput('one');
    await loop.handleUserInput('two');
    await p1;
    await new Promise((r) => setTimeout(r, 20));
    expect(queueStates[0]).toEqual(['two']);
    expect(items.filter((i) => i.kind === 'user').map((i) => i.message.content)).toEqual(['one', 'two']);
  });

  it('confines file access to the workspace', async () => {
    script = [{ functionCalls: [{ name: 'read_file', args: { file_path: '/etc/passwd' } }] }, { text: 'ok' }];
    const { cb } = makeCallbacks();
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    await loop.handleUserInput('leak');
    expect(calls[1].responses[0].output).toMatch(/Accès refusé/);
  });

  it('tracks the task list written with todo_write and persists it in the session', async () => {
    script = [
      { functionCalls: [{ name: 'todo_write', args: { todos: [{ content: 'a', status: 'in_progress', activeForm: 'Doing a' }, { content: 'b', status: 'pending' }] } }] },
      { text: 'ok' },
    ];
    const seen: any[] = [];
    const { cb } = makeCallbacks({ onTodosChange: (t) => seen.push(t) });
    const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
    await loop.handleUserInput('plan');
    expect(seen[0]).toHaveLength(2);
    expect(loop.getTodos()[0].status).toBe('in_progress');
    expect(loop.getSessionData().todos).toHaveLength(2);
    expect(calls[1].responses[0].output).toMatch(/Todos updated \(0\/2 completed, 1 in progress\)/);
  });

  describe('hooks', () => {
    const withHooks = (hooks: Record<string, unknown>) => {
      fs.mkdirSync(path.join(cwd, '.fuller'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.fuller', 'settings.json'), JSON.stringify({ hooks }));
      return getConfig({ workspaceDir: cwd, apiKey: 'x' });
    };

    it('PreToolUse can deny a tool call with a reason', async () => {
      script = [{ functionCalls: [{ name: 'execute_bash', args: { command: 'ls' } }] }, { text: 'ok' }];
      const config = withHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: `echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"policy: no shell"}}'` }] }] });
      const { cb, items } = makeCallbacks();
      const loop = new AgentLoop(config, cb);
      await loop.handleUserInput('list');
      expect(calls[1].responses[0].output).toMatch(/blocked by a hook.*policy: no shell/);
      expect(items.some((i) => i.kind === 'tool' && i.toolCall.status === 'rejected')).toBe(true);
    });

    it('PreToolUse allow skips the permission prompt and updatedInput rewrites the arguments', async () => {
      script = [{ functionCalls: [{ name: 'write_file', args: { file_path: 'h.txt', content: 'x' } }] }, { text: 'ok' }];
      const config = withHooks({ PreToolUse: [{ matcher: 'Write', hooks: [{ command: `echo '{"hookSpecificOutput":{"permissionDecision":"allow","updatedInput":{"content":"from hook"}}}'` }] }] });
      const ask = vi.fn();
      const { cb } = makeCallbacks({ onRequestConfirmation: ask });
      const loop = new AgentLoop(config, cb);
      await loop.handleUserInput('write');
      expect(ask).not.toHaveBeenCalledWith(expect.objectContaining({ toolCall: expect.anything() }));
      expect(fs.readFileSync(path.join(cwd, 'h.txt'), 'utf8')).toBe('from hook');
    });

    it('UserPromptSubmit can block a prompt and add context', async () => {
      script = [{ text: 'never' }, { text: 'answer' }];
      const config = withHooks({ UserPromptSubmit: [{ hooks: [{ command: `python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(2) if 'secret' in d['prompt'] else print('context: be brief')"` }] }] });
      const { cb, items } = makeCallbacks();
      const loop = new AgentLoop(config, cb);
      await loop.handleUserInput('tell me the secret');
      expect(calls).toHaveLength(0);
      expect(items.some((i) => i.kind === 'system' && /Prompt blocked by hook/.test(i.message.content))).toBe(true);
      await loop.handleUserInput('hello');
      expect(calls[0].text).toMatch(/^context: be brief\n\nhello$/);
    });

    it('PostToolUse feedback is appended to the tool result', async () => {
      script = [{ functionCalls: [{ name: 'read_file', args: { file_path: 'a.txt' } }] }, { text: 'ok' }];
      const config = withHooks({ PostToolUse: [{ matcher: 'Read', hooks: [{ command: 'echo "lint: fine" >&2; exit 2' }] }] });
      const { cb } = makeCallbacks();
      const loop = new AgentLoop(config, cb);
      await loop.handleUserInput('read');
      expect(calls[1].responses[0].output).toMatch(/hello[\s\S]*\[Hook feedback\] lint: fine/);
    });

    it('a blocking Stop hook continues once with its reason', async () => {
      script = [{ text: 'first answer' }, { text: 'second answer' }, { text: 'third' }];
      const config = withHooks({ Stop: [{ hooks: [{ command: `python3 -c "import sys,json; d=json.load(sys.stdin); (print('ok') if d.get('stop_hook_active') else (sys.stderr.write('run the tests first'), sys.exit(2)))"` }] }] });
      const { cb, items } = makeCallbacks();
      const loop = new AgentLoop(config, cb);
      await loop.handleUserInput('do it');
      await new Promise((r) => setTimeout(r, 50));
      const userCalls = calls.filter((c) => c.kind === 'user');
      expect(userCalls).toHaveLength(2);
      expect(userCalls[1].text).toMatch(/run the tests first/);
      expect(items.filter((i) => i.kind === 'text').map((i) => i.content)).toEqual(['first answer', 'second answer']);
    });
  });

  describe('plan mode', () => {
    it('exit_plan_mode shows the plan, asks for approval and switches the mode', async () => {
      script = [{ functionCalls: [{ name: 'exit_plan_mode', args: { plan: '1. Do a\n2. Do b' } }] }, { text: 'implementing' }];
      let seen: any = null;
      const modes: string[] = [];
      const { cb, items } = makeCallbacks({
        onRequestConfirmation: (c) => { if (c) { seen = c; c.onDecide({ kind: 'yes' }); } },
        onModeChange: (m) => modes.push(m),
      });
      const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x', permissionMode: 'plan' }), cb);
      await loop.handleUserInput('plan it');
      expect(seen.title).toBe('Would you like to proceed?');
      expect(seen.options.map((o: any) => o.label)).toEqual(['Yes, and auto-accept edits', 'Yes, manually approve edits', 'No, keep planning']);
      expect(modes).toEqual(['acceptEdits']);
      expect(loop.permissionMode).toBe('acceptEdits');
      expect(items.some((i) => i.kind === 'text' && /\*\*Plan\*\*[\s\S]*Do b/.test(i.content))).toBe(true);
      expect(calls[1].responses[0].output).toMatch(/approved the plan.*acceptEdits/);
    });

    it('a rejected plan keeps plan mode and forwards the feedback', async () => {
      script = [{ functionCalls: [{ name: 'exit_plan_mode', args: { plan: 'x' } }] }, { text: 'revising' }];
      const { cb } = makeCallbacks({ onRequestConfirmation: (c) => c?.onDecide({ kind: 'no', feedback: 'add tests' }) });
      const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x', permissionMode: 'plan' }), cb);
      await loop.handleUserInput('plan it');
      expect(loop.permissionMode).toBe('plan');
      expect(calls[1].responses[0].output).toMatch(/did not approve the plan: "add tests"/);
    });

    it('outside plan mode the tool is a no-op', async () => {
      script = [{ functionCalls: [{ name: 'exit_plan_mode', args: { plan: 'x' } }] }, { text: 'ok' }];
      const ask = vi.fn();
      const { cb } = makeCallbacks({ onRequestConfirmation: ask });
      const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
      await loop.handleUserInput('go');
      expect(ask).not.toHaveBeenCalledWith(expect.objectContaining({ toolCall: expect.anything() }));
      expect(calls[1].responses[0].output).toMatch(/Not in plan mode/);
    });
  });

  describe('MCP', () => {
    it('exposes MCP tools, asks for permission and calls the server', async () => {
      const fixture = path.join(process.cwd(), 'tests', 'fixtures', 'mcp-echo.mjs');
      fs.writeFileSync(path.join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [fixture] } } }));
      script = [{ functionCalls: [{ name: 'mcp__echo__echo', args: { text: 'salut' } }] }, { text: 'done' }];
      let asked: any = null;
      const { cb, items } = makeCallbacks({ onRequestConfirmation: (c) => { if (c) { asked = c; c.onDecide({ kind: 'yes' }); } } });
      const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
      await loop.mcpReady();
      expect(loop.mcpStatuses()[0]).toMatchObject({ name: 'echo', status: 'connected', toolCount: 3 });
      expect(items.some((i) => i.kind === 'system' && /MCP echo connected · 3 tools/.test(i.message.content))).toBe(true);
      await loop.handleUserInput('echo');
      expect(asked.title).toMatch(/call the MCP tool echo \(server echo\)/);
      expect(asked.options[1].rule).toBe('mcp__echo__echo');
      expect(calls[1].responses[0].output).toBe('echo: salut');
      await loop.flush();
    }, 30000);
  });

  describe('subagents', () => {
    it('runs a subagent in its own session, routes permissions to the parent and returns its report', async () => {
      script = [
        { functionCalls: [{ name: 'agent', args: { description: 'explore files', prompt: 'read a.txt', subagent_type: 'Explore' } }] },
        { functionCalls: [{ name: 'read_file', args: { file_path: 'a.txt' } }, { name: 'write_file', args: { file_path: 'x', content: 'x' } }] },
        { text: 'sub report: a.txt says hello' },
        { text: 'final answer' },
      ];
      const progress: string[] = [];
      const { cb, items } = makeCallbacks({ onLive: (l) => { if (l?.tools[0]?.result) progress.push(l.tools[0].result); } });
      const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
      await loop.handleUserInput('delegate');
      const toolItem = items.find((i) => i.kind === 'tool' && i.toolCall.name === 'agent') as any;
      expect(toolItem.toolCall.status).toBe('completed');
      expect(toolItem.toolCall.result).toBe('sub report: a.txt says hello');
      expect(toolItem.toolCall.summary).toMatch(/1 tool use/);
      expect(calls.map((c) => c.kind)).toEqual(['user', 'user', 'tools', 'tools']);
      expect(calls[2].responses[0].output).toContain('hello');
      expect(calls[2].responses[1].output).toMatch(/may not use write_file/);
      expect(calls[3].responses[0].output).toMatch(/Explore subagent report[\s\S]*sub report/);
      expect(progress.some((p) => /Read\(a\.txt\)/.test(p))).toBe(true);
    });
  });

  describe('images', () => {
    it('sends pasted and dropped images as inline parts and records their metadata', async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
      fs.writeFileSync(path.join(cwd, 'shot.png'), png);
      fs.writeFileSync(path.join(cwd, 'clip.png'), png);
      script = [{ text: 'I see it' }];
      const { cb, items } = makeCallbacks();
      const loop = new AgentLoop(getConfig({ workspaceDir: cwd, apiKey: 'x' }), cb);
      await loop.handleUserInput('what is in shot.png and [Image #1: clip.png]?', 'normal', { attachments: [{ n: 1, path: path.join(cwd, 'clip.png'), mimeType: 'image/png', bytes: png.length, name: 'clip.png' }] });
      const parts = calls[0].parts;
      expect(parts[0].text).toMatch(/what is in shot\.png/);
      expect(parts.filter((p: any) => p.inlineData)).toHaveLength(2);
      expect(parts[1].inlineData.data).toBe(png.toString('base64'));
      const user = items.find((i) => i.kind === 'user') as any;
      expect(user.message.attachments.map((a: any) => a.name)).toEqual(['clip.png', 'shot.png']);
    });
  });
});
