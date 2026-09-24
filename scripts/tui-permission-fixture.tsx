/** Scripted permission turn for PTY captures. Never calls Gemini or runs Bash. */
import React from 'react';
import { render } from 'ink';
import { App } from '../src/ui/App.js';
import { AgentLoop, type AgentCallbacks } from '../src/agent/loop.js';
import { getConfig } from '../src/config.js';
import { evaluatePermission } from '../src/permissions/rules.js';
import { installFrameWriter } from '../src/ui/frameWriter.js';
import type { ToolCallState } from '../src/agent/types.js';

const workspaceDir = process.argv[2] ?? process.cwd();
const fullscreen = process.argv[3] === 'fullscreen';
const config = getConfig({ apiKey: 'terminal-fixture-only', workspaceDir });
config.notifications = 'off';
config.permissionMode = 'default';

(AgentLoop.prototype as any).handleUserInput = async function (input: string) {
  const callbacks = (this as any).callbacks as AgentCallbacks;
  callbacks.onCommit({ key: 'fixture-user', kind: 'user', message: { id: 'fixture-user', role: 'user', content: input, timestamp: 0 } });
  callbacks.onStatusChange('thinking');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const tool: ToolCallState = {
    id: 'fixture-tool', name: 'execute_bash', status: 'confirming',
    args: { command: 'sudo ip link set tun0 down && sudo ip link set tun1 down', description: 'Bring down VPN tunnel interfaces' },
  };
  callbacks.onLive({ text: '', tools: [tool] });
  callbacks.onStatusChange('awaiting_permission');
  await new Promise((resolve) => setTimeout(resolve, 350));
  const approval = evaluatePermission(tool.name, tool.args, workspaceDir, 'default', {});
  callbacks.onRequestConfirmation({
    toolCall: tool, title: approval.title, danger: approval.danger, options: approval.options,
    onDecide: () => {
      callbacks.onRequestConfirmation(null);
      callbacks.onLive({ text: '', tools: [{ ...tool, status: 'running' }] });
      callbacks.onStatusChange('running_tool');
      setTimeout(() => {
        callbacks.onCommit({ key: tool.id, kind: 'tool', messageId: 'fixture-assistant', toolCall: { ...tool, status: 'completed', result: 'SIMULATED_RESULT_UNIQUE' } });
        callbacks.onLive(null);
        callbacks.onStatusChange('idle');
      }, 100);
    },
  });
};

const stdout = process.stdout;
const originalWrite = stdout.write.bind(stdout);
originalWrite(fullscreen ? '\x1b[?1049h\x1b[H' : '\x1b[2J\x1b[3J\x1b[H');
const writer = installFrameWriter(stdout);
originalWrite('\x1b[?2004h');
const inkStdout = new Proxy(stdout, {
  get(target, prop, receiver) {
    if (prop === 'columns') return Math.max(20, (target.columns || 80) - 1);
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
}) as NodeJS.WriteStream;
const app = render(<App config={config} frameWriter={writer} fullscreen={fullscreen} />, { stdout: inkStdout, exitOnCtrlC: false, patchConsole: false });
process.on('SIGTERM', () => {
  app.unmount();
  writer.restore();
  originalWrite(fullscreen ? '\x1b[?1049l' : '\x1b[?25h');
  process.exit(0);
});
await app.waitUntilExit();
