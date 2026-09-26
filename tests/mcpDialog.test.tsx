import React from 'react';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import { McpDialog, parameterLines, reconnectMessage, type McpApi } from '../src/ui/McpDialog.js';
import type { McpServerStatus, McpToolInfo } from '../src/mcp/manager.js';

const wrap = (child: React.ReactNode) => <ThemeProvider theme={loadTheme('dark')}>{child}</ThemeProvider>;
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeApi() {
  const project = '/work/demo/.mcp.json';
  const servers: McpServerStatus[] = [
    { name: 'echo', scope: 'project', status: 'connected', toolCount: 2, transport: 'stdio', endpoint: 'node echo.mjs', file: project, capabilities: ['tools'] },
    { name: 'docs', scope: 'user', status: 'failed', error: 'spawn docs ENOENT', toolCount: 0, transport: 'http', endpoint: 'https://docs.example/mcp', file: path.join(os.homedir(), '.fuller', 'mcp.json') },
  ];
  const tools: McpToolInfo[] = [
    { server: 'echo', name: 'echo', fullName: 'mcp__echo__echo', description: 'Echo the text back', inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Text to echo' } }, required: ['text'] } },
    { server: 'echo', name: 'add', fullName: 'mcp__echo__add', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
  ];
  const api: McpApi = {
    statuses: () => servers.map((s) => ({ ...s })),
    toolsOf: (server) => tools.filter((t) => t.server === server),
    reconnect: vi.fn(async (name: string) => ({ ...servers.find((s) => s.name === name)!, status: 'connected' as const })),
    setEnabled: vi.fn(async (name: string, enabled: boolean) => {
      const server = servers.find((s) => s.name === name)!;
      Object.assign(server, enabled ? { status: 'connected', toolCount: 2 } : { status: 'disabled', toolCount: 0 });
      return { ...server };
    }),
  };
  return { api, servers };
}

async function open(api: McpApi, onClose = vi.fn()) {
  const screen = render(wrap(<McpDialog api={api} onClose={onClose} />));
  await vi.waitFor(() => expect(screen.lastFrame()).toContain('Manage MCP servers'));
  await tick();
  return { screen, onClose };
}
const lines = (frame: string | undefined) => (frame ?? '').split('\n').map((line) => line.trimEnd());

describe('/mcp (Claude Code 2.1.283, captured 26/09)', () => {
  it('groups the servers by the file that declares them', async () => {
    const { screen } = await open(fakeApi().api);
    const rows = lines(screen.lastFrame());
    expect(rows).toContain('   2 servers');
    expect(rows).toContain('     Project MCPs (/work/demo/.mcp.json)');
    expect(rows).toContain('   ❯ ✔ echo   2 tools');
    expect(rows).toContain('     User MCPs (~/.fuller/mcp.json)');
    expect(rows).toContain('     ✘ docs   failed');
    expect(rows.at(-1)).toBe('   ↑/↓ to navigate · Enter to confirm · Esc to cancel');
    screen.unmount();
  });

  it('opens a server, its tools and a tool, and goes back with Esc', async () => {
    const { screen, onClose } = await open(fakeApi().api);
    screen.stdin.write('\r');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('Echo MCP Server'));
    let rows = lines(screen.lastFrame());
    expect(rows).toContain('   Status:           ✔ connected');
    expect(rows).toContain('   Command:          node echo.mjs');
    expect(rows).toContain('   Config location:  /work/demo/.mcp.json');
    expect(rows).toContain('   Capabilities: tools');
    expect(rows).toContain('   Tools: 2 tools');
    expect(rows).toContain('   ❯ 1. View tools');
    expect(rows).toContain('     2. Reconnect');
    expect(rows).toContain('     3. Disable');
    expect(rows.at(-1)).toBe('   ↑/↓ to navigate · Enter to select · Esc to back');
    screen.stdin.write('\r');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('Tools for echo'));
    expect(lines(screen.lastFrame())).toContain('   ❯ echo');
    screen.stdin.write('\r');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('Tool name: echo'));
    rows = lines(screen.lastFrame());
    expect(rows).toContain('   Full name: mcp__echo__echo');
    expect(rows).toContain('   Echo the text back');
    expect(rows).toContain('     ● text (required): string - Text to echo');
    expect(rows.at(-1)).toBe('   Esc to go back');
    for (const title of ['Tools for echo', 'Echo MCP Server', 'Manage MCP servers']) {
      screen.stdin.write('\x1b');
      await vi.waitFor(() => expect(screen.lastFrame()).toContain(title));
    }
    expect(onClose).not.toHaveBeenCalled();
    screen.stdin.write('\x1b');
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledWith());
    screen.unmount();
  });

  it('shows why a server failed, and Reconnect closes with its result', async () => {
    const { api } = fakeApi();
    const { screen, onClose } = await open(api);
    screen.stdin.write('\x1b[B');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('❯ ✘ docs'));
    screen.stdin.write('\r');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('Docs MCP Server'));
    const rows = lines(screen.lastFrame());
    expect(rows).toContain('   Status:           ✘ failed');
    expect(rows).toContain('   Issue:            spawn docs ENOENT');
    expect(rows).toContain('   URL:              https://docs.example/mcp');
    expect(rows).toContain('   ❯ 1. Reconnect');
    screen.stdin.write('\r');
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledWith('Reconnected to docs.'));
    expect(api.reconnect).toHaveBeenCalledWith('docs');
    screen.unmount();
  });

  it('Disable goes back to the list with the server off; Enable is then offered', async () => {
    const { api } = fakeApi();
    const { screen } = await open(api);
    screen.stdin.write('\r');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('3. Disable'));
    screen.stdin.write('3');
    await vi.waitFor(() => expect(lines(screen.lastFrame())).toContain('   ❯ ◯ echo'));
    expect(api.setEnabled).toHaveBeenCalledWith('echo', false);
    screen.stdin.write('\r');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('◯ disabled'));
    expect(lines(screen.lastFrame())).toContain('   ❯ 1. Enable');
    expect(screen.lastFrame()).not.toContain('Reconnect');
    screen.stdin.write('\r');
    await vi.waitFor(() => expect(lines(screen.lastFrame())).toContain('   ❯ ✔ echo   2 tools'));
    expect(api.setEnabled).toHaveBeenLastCalledWith('echo', true);
    screen.unmount();
  });

  it('words the results and parameters as Claude Code does', () => {
    const base = { name: 'echo', scope: 'project' as const, toolCount: 0, transport: 'stdio' as const, endpoint: 'x', file: 'f' };
    expect(reconnectMessage({ ...base, status: 'connected' })).toBe('Reconnected to echo.');
    expect(reconnectMessage({ ...base, status: 'failed', error: 'timed out' })).toBe('Failed to reconnect to echo: timed out');
    expect(reconnectMessage({ ...base, status: 'failed' })).toBe('Failed to reconnect to echo.');
    expect(parameterLines({ properties: { a: { type: 'number' }, mode: { enum: ['x'] } }, required: ['a'] })).toEqual([
      { name: 'a', required: true, detail: 'number' },
      { name: 'mode', required: false, detail: 'enum' },
    ]);
  });
});
