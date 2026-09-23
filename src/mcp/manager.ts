import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { FunctionDeclaration } from '@google/genai';
import { APP_SLUG, APP_VERSION } from '../branding.js';
import { isHttpServer, type McpServerEntry } from './config.js';
import { mcpToolName, toGeminiSchema } from './schema.js';
import { truncateMiddle } from '../tools/truncate.js';

export interface McpToolInfo {
  server: string;
  name: string;
  fullName: string;
  description?: string;
  inputSchema: any;
}

export interface McpServerStatus {
  name: string;
  scope: McpServerEntry['scope'];
  status: 'connecting' | 'connected' | 'failed';
  error?: string;
  toolCount: number;
  transport: 'stdio' | 'http';
}

const MAX_OUTPUT = 100_000;

/** Connects to configured MCP servers and exposes their tools to the model. */
export class McpManager {
  private clients = new Map<string, Client>();
  private tools = new Map<string, McpToolInfo>();
  private status = new Map<string, McpServerStatus>();
  private readyPromise: Promise<void> | null = null;

  constructor(
    private readonly entries: McpServerEntry[],
    private readonly options: { onStatus?: (statuses: McpServerStatus[]) => void; connectTimeoutMs?: number } = {}
  ) {
    for (const e of entries) {
      this.status.set(e.name, { name: e.name, scope: e.scope, status: 'connecting', toolCount: 0, transport: isHttpServer(e.config) ? 'http' : 'stdio' });
    }
  }

  public get configured(): number {
    return this.entries.length;
  }

  public connectAll(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = Promise.all(this.entries.map((e) => this.connect(e))).then(() => undefined);
    }
    return this.readyPromise;
  }

  public ready(): Promise<void> {
    return this.readyPromise ?? Promise.resolve();
  }

  private emit() {
    this.options.onStatus?.(this.statuses());
  }

  private async connect(entry: McpServerEntry): Promise<void> {
    const timeoutMs = this.options.connectTimeoutMs ?? 10_000;
    const st = this.status.get(entry.name)!;
    try {
      const client = new Client({ name: APP_SLUG, version: APP_VERSION }, { capabilities: {} });
      const transport = await this.createTransport(entry);
      await withTimeout(client.connect(transport), timeoutMs, `connection to ${entry.name} timed out`);
      const { tools } = await withTimeout(client.listTools(), timeoutMs, `listing tools of ${entry.name} timed out`);
      this.clients.set(entry.name, client);
      for (const t of tools) {
        const info: McpToolInfo = { server: entry.name, name: t.name, fullName: mcpToolName(entry.name, t.name), description: t.description, inputSchema: t.inputSchema };
        this.tools.set(info.fullName, info);
      }
      st.status = 'connected';
      st.toolCount = tools.length;
    } catch (err: any) {
      st.status = 'failed';
      st.error = String(err?.message ?? err).split('\n')[0].slice(0, 200);
    }
    this.emit();
  }

  private async createTransport(entry: McpServerEntry) {
    const cfg = entry.config;
    if (isHttpServer(cfg)) {
      const url = new URL(cfg.url);
      const requestInit = cfg.headers ? { headers: cfg.headers } : undefined;
      if (cfg.type === 'sse') return new SSEClientTransport(url, { requestInit });
      try {
        const t = new StreamableHTTPClientTransport(url, { requestInit });
        return t;
      } catch {
        return new SSEClientTransport(url, { requestInit });
      }
    }
    return new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: { ...(process.env as Record<string, string>), ...(cfg.env ?? {}) },
      cwd: cfg.cwd,
      stderr: 'ignore',
    });
  }

  public statuses(): McpServerStatus[] {
    return [...this.status.values()];
  }

  public getTools(): McpToolInfo[] {
    return [...this.tools.values()];
  }

  public hasTool(fullName: string): boolean {
    return this.tools.has(fullName);
  }

  public getDeclarations(): FunctionDeclaration[] {
    return this.getTools().map((t) => ({
      name: t.fullName,
      description: `[MCP ${t.server}] ${t.description ?? t.name}`.slice(0, 1000),
      parameters: toGeminiSchema(t.inputSchema ?? { type: 'object' }),
    }));
  }

  public async callTool(fullName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ output: string; summary?: string }> {
    const info = this.tools.get(fullName);
    if (!info) throw new Error(`Unknown MCP tool ${fullName}`);
    const client = this.clients.get(info.server);
    if (!client) throw new Error(`MCP server ${info.server} is not connected`);
    let params: Record<string, unknown> = args ?? {};
    if ('input' in params && Object.keys(params).length === 1 && typeof params.input === 'string' && !(info.inputSchema?.properties && 'input' in info.inputSchema.properties)) {
      try { params = JSON.parse(params.input as string); } catch { params = {}; }
    }
    const result: any = await client.callTool({ name: info.name, arguments: params }, undefined, { signal, timeout: 120_000 });
    const parts: string[] = [];
    for (const c of result?.content ?? []) {
      if (c.type === 'text') parts.push(String(c.text ?? ''));
      else if (c.type === 'image') parts.push(`[image ${c.mimeType ?? ''}, ${Math.round(String(c.data ?? '').length * 0.75)} bytes]`);
      else if (c.type === 'audio') parts.push(`[audio ${c.mimeType ?? ''}]`);
      else if (c.type === 'resource') parts.push(c.resource?.text ? String(c.resource.text) : `[resource ${c.resource?.uri ?? ''}]`);
      else if (c.type === 'resource_link') parts.push(`[resource link ${c.uri ?? ''}${c.name ? ` — ${c.name}` : ''}]`);
    }
    if (result?.structuredContent && parts.length === 0) parts.push(JSON.stringify(result.structuredContent, null, 2));
    const output = truncateMiddle(parts.join('\n').trim() || '(empty result)', MAX_OUTPUT);
    if (result?.isError) throw new Error(output);
    return { output, summary: `${output.split('\n').length} lines` };
  }

  public async close(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.close().catch(() => undefined)));
    this.clients.clear();
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
