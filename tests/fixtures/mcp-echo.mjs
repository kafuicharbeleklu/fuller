// Minimal MCP server used by the tests (stdio): echo + add tools.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'echo', version: '1.0.0' });
server.registerTool('echo', { description: 'Echo the text back', inputSchema: { text: z.string().describe('Text to echo') } }, async ({ text }) => ({ content: [{ type: 'text', text: `echo: ${text}` }] }));
server.registerTool('add', { description: 'Add two numbers', inputSchema: { a: z.number(), b: z.number() } }, async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }));
server.registerTool('fail', { description: 'Always fails' }, async () => ({ isError: true, content: [{ type: 'text', text: 'boom' }] }));
await server.connect(new StdioServerTransport());
