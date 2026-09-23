import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const calls: any[] = [];
let script: Array<{ text?: string; functionCalls?: any[] }> = [];

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
    async sendUserMessage(text: string, opts: any) {
      calls.push({ kind: 'user', text });
      return this.next(opts);
    }
    async sendToolResponses(responses: any[], opts: any) {
      calls.push({ kind: 'tools', responses });
      return this.next(opts);
    }
    private async next(opts: any) {
      const step = script.shift() ?? { text: 'done' };
      if (step.text) opts?.onChunk?.(step.text);
      return { text: step.text ?? '', functionCalls: step.functionCalls ?? [], usage: { promptTokens: 10, responseTokens: 5, totalTokens: 15, thoughtsTokens: 0 } };
    }
    async compactHistory() { return 'summary'; }
    async oneShot() { return ''; }
  }
  return { GeminiAgentSession, historyToText: () => '', sanitizeHistory: (h: any) => h };
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
      expect(seen.options.map((o: any) => o.label)).toEqual(['Yes, and auto-accept edits', 'Yes, manually approve edits', 'No, keep planning (tell Fuller what to change)']);
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
});
