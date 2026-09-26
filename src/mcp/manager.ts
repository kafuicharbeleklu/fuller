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
  /** 'disabled': turned off for this project (/mcp), or a project server not approved. */
  status: 'connecting' | 'connected' | 'failed' | 'disabled';
  error?: string;
  toolCount: number;
  transport: 'stdio' | 'http';
  /** The command line (stdio) or the URL (http), as /mcp shows it. */
  endpoint: string;
  /** The file that declares the server. */
  file: string;
  /** What the connected server offers: tools, prompts, resources. */
  capabilities?: string[];
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
    private readonly options: {
      /** `changed`: the server whose state moved; `quiet`: the user asked for it in /mcp, no notice. */
      onStatus?: (statuses: McpServerStatus[], changed?: string, quiet?: boolean) => void;
      connectTimeoutMs?: number;
      /** Servers listed but not started (turned off for this project, or not approved). */
      disabled?: Iterable<string>;
    } = {}
  ) {
    const off = new Set(options.disabled ?? []);
    for (const e of entries) {
      const endpoint = isHttpServer(e.config) ? e.config.url : [e.config.command, ...(e.config.args ?? [])].join(' ');
      this.status.set(e.name, { name: e.name, scope: e.scope, status: off.has(e.name) ? 'disabled' : 'connecting', toolCount: 0, transport: isHttpServer(e.config) ? 'http' : 'stdio', endpoint, file: e.file });
    }
  }

  /** Servers to start (the disabled ones are only listed). */
  public get configured(): number {
    return this.entries.filter((e) => this.status.get(e.name)?.status !== 'disabled').length;
  }

  public connectAll(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = Promise.all(this.entries.filter((e) => this.status.get(e.name)?.status !== 'disabled').map((e) => this.connect(e))).then(() => undefined);
    }
    return this.readyPromise;
  }

  /** The tools of one server, with their input schema (/mcp → View tools). */
  public toolsOf(server: string): McpToolInfo[] {
    return this.getTools().filter((t) => t.server === server);
  }

  /** Stop a server's process and forget its tools. */
  private async drop(name: string): Promise<void> {
    const client = this.clients.get(name);
    this.clients.delete(name);
    for (const [key, tool] of this.tools) if (tool.server === name) this.tools.delete(key);
    await client?.close().catch(() => undefined);
  }

  /** /mcp → Reconnect: restart the server and list its tools again. */
  public async reconnect(name: string): Promise<McpServerStatus> {
    const entry = this.entries.find((e) => e.name === name);
    const st = this.status.get(name);
    if (!entry || !st) throw new Error(`Unknown MCP server ${name}`);
    await this.drop(name);
    Object.assign(st, { status: 'connecting', error: undefined, toolCount: 0, capabilities: undefined });
    this.emit(name, true);
    await this.connect(entry, true);
    return { ...st };
  }

  /** /mcp → Disable or Enable, for this session; the caller keeps the choice. */
  public async setEnabled(name: string, enabled: boolean): Promise<McpServerStatus> {
    const st = this.status.get(name);
    if (!st) throw new Error(`Unknown MCP server ${name}`);
    if (!enabled) {
      await this.drop(name);
      Object.assign(st, { status: 'disabled', error: undefined, toolCount: 0, capabilities: undefined });
      this.emit(name, true);
      return { ...st };
    }
    if (st.status !== 'disabled') return { ...st };
    return this.reconnect(name);
  }

  public ready(): Promise<void> {
    return this.readyPromise ?? Promise.resolve();
  }

  private emit(changed?: string, quiet = false) {
    this.options.onStatus?.(this.statuses(), changed, quiet);
  }

  private async connect(entry: McpServerEntry, quiet = false): Promise<void> {
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
      const caps = client.getServerCapabilities() ?? {};
      st.capabilities = (['tools', 'prompts', 'resources'] as const).filter((cap) => caps[cap]);
      st.status = 'connected';
      st.toolCount = tools.length;
    } catch (err: any) {
      st.status = 'failed';
      st.error = String(err?.message ?? err).split('\n')[0].slice(0, 200);
    }
    this.emit(entry.name, quiet);
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
    return [...this.status.values()].map((st) => ({ ...st }));
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
