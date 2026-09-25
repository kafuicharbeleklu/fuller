import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { approvalFile, isApproved, mcpApproval, pendingServers, saveMcpApproval } from '../src/mcp/approval.js';
import type { McpServerEntry } from '../src/mcp/config.js';
import { McpApprovalDialog } from '../src/ui/McpApprovalDialog.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';

const tick = () => new Promise((r) => setTimeout(r, 30));
const realHome = process.env.HOME;
let tempHome: string;
beforeEach(() => { tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-mcp-home-')); process.env.HOME = tempHome; });
afterEach(() => {
  process.env.HOME = realHome;
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
});
const entry = (name: string, scope: 'project' | 'user' = 'project'): McpServerEntry => ({ name, scope, file: '.mcp.json', config: { command: 'x' } });
const show = (names: string[], onDone: (a: any) => void) => render(<ThemeProvider theme={loadTheme('dark')}><McpApprovalDialog names={names} onDone={onDone} /></ThemeProvider>);

describe('project MCP server approval', () => {
  it('starts user servers, and project servers only once enabled; remembers answers outside the project', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-mcp-project-'));
    try {
      const entries = [entry('alpha'), entry('beta'), entry('mine', 'user')];
      expect(pendingServers(entries, mcpApproval(project)).map((e) => e.name)).toEqual(['alpha', 'beta']);
      expect(isApproved(entries[2], mcpApproval(project))).toBe(true);
      saveMcpApproval(project, { enabled: ['alpha'], disabled: ['beta'] });
      const approval = mcpApproval(project);
      expect(isApproved(entries[0], approval)).toBe(true);
      expect(isApproved(entries[1], approval)).toBe(false);
      expect(pendingServers([...entries, entry('gamma')], approval).map((e) => e.name)).toEqual(['gamma']);
      // "all future servers": new ones start without a question, an explicit refusal still holds.
      saveMcpApproval(project, { enabled: ['gamma'], disabled: [], all: true });
      expect(pendingServers([entry('delta')], mcpApproval(project))).toEqual([]);
      expect(isApproved(entry('delta'), mcpApproval(project))).toBe(true);
      expect(isApproved(entries[1], mcpApproval(project))).toBe(false);
      expect(fs.existsSync(path.join(project, '.fuller'))).toBe(false);
      expect(fs.statSync(approvalFile()).mode & 0o077).toBe(0);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it('asks about one server like Claude Code, "Continue without" selected', async () => {
    const onDone = vi.fn();
    const screen = show(['demo'], onDone);
    await tick();
    expect(screen.lastFrame()).toContain('New MCP server found in this project: demo');
    expect(screen.lastFrame()).toContain('MCP servers may execute code or access system resources.');
    expect(screen.lastFrame()).toMatch(/Use this MCP server\n\s+Use this and all future MCP servers in this project\n\s*❯ Continue without using this MCP server/);
    screen.stdin.write('\r'); await tick();
    expect(onDone).toHaveBeenLastCalledWith({ enabled: [], disabled: ['demo'] });
    screen.stdin.write('\x1b[A'); await tick();
    screen.stdin.write('\r'); await tick();
    expect(onDone).toHaveBeenLastCalledWith({ enabled: ['demo'], disabled: [], all: true });
    screen.unmount();
  });

  it('lists several servers checked, toggles with Space, confirms with "Enable selected", Esc rejects all', async () => {
    const onDone = vi.fn();
    const screen = show(['alpha', 'beta'], onDone);
    await tick();
    expect(screen.lastFrame()).toContain('2 new MCP servers found in this project');
    expect(screen.lastFrame()).toContain('Select any you wish to enable.');
    expect(screen.lastFrame()).toMatch(/❯ \[✔\] alpha\n\s+\[✔\] beta\n\s+Enable selected/);
    expect(screen.lastFrame()).toContain('Space to select · Esc to reject all');
    screen.stdin.write('\x1b[B'); await tick();
    screen.stdin.write(' '); await tick();
    expect(screen.lastFrame()).toContain('[ ] beta');
    screen.stdin.write('\x1b[B'); await tick();
    screen.stdin.write('\r'); await tick();
    expect(onDone).toHaveBeenLastCalledWith({ enabled: ['alpha'], disabled: ['beta'] });
    screen.stdin.write('\x1b'); await tick();
    expect(onDone).toHaveBeenLastCalledWith({ enabled: [], disabled: ['alpha', 'beta'] });
    screen.unmount();
  });
});
