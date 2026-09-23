import { describe, expect, it, afterAll } from 'vitest';
import path from 'node:path';
import { McpManager } from '../src/mcp/manager.js';
import type { McpServerEntry } from '../src/mcp/config.js';

const fixture = path.join(process.cwd(), 'tests', 'fixtures', 'mcp-echo.mjs');
const entries: McpServerEntry[] = [
  { name: 'echo', scope: 'project', file: 'test', config: { command: process.execPath, args: [fixture] } },
  { name: 'broken', scope: 'project', file: 'test', config: { command: process.execPath, args: ['-e', 'process.exit(1)'] } },
];

describe('MCP manager', () => {
  const manager = new McpManager(entries, { connectTimeoutMs: 15000 });
  afterAll(() => manager.close());

  it('connects, lists tools and reports failures', async () => {
    await manager.connectAll();
    const statuses = Object.fromEntries(manager.statuses().map((s) => [s.name, s]));
    expect(statuses.echo.status).toBe('connected');
    expect(statuses.echo.toolCount).toBe(3);
    expect(statuses.broken.status).toBe('failed');
    const decls = manager.getDeclarations();
    const echo = decls.find((d) => d.name === 'mcp__echo__echo')!;
    expect(echo.parameters).toMatchObject({ type: 'OBJECT', properties: { text: { type: 'STRING', description: 'Text to echo' } }, required: ['text'] });
  }, 30000);

  it('calls tools and surfaces errors', async () => {
    await manager.connectAll();
    expect((await manager.callTool('mcp__echo__echo', { text: 'hi' })).output).toBe('echo: hi');
    expect((await manager.callTool('mcp__echo__add', { a: 2, b: 3 })).output).toBe('5');
    await expect(manager.callTool('mcp__echo__fail', {})).rejects.toThrow(/boom/);
    await expect(manager.callTool('mcp__nope__x', {})).rejects.toThrow(/Unknown MCP tool/);
  }, 30000);
});
