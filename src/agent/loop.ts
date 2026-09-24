import { GeminiAgentSession, historyToText, type ToolResponsePayload, type TurnUsage } from './gemini.js';
import { dispatchTool, previewTool, toolLabel } from '../tools/registry.js';
import { evaluatePermission, type Evaluation } from '../permissions/rules.js';
import { addPermissionRule, type AppConfig } from '../config.js';
import { resolveMentions } from '../utils/mentions.js';
import { describeError } from './retry.js';
import { CheckpointManager, type Checkpoint } from '../checkpoint/manager.js';
import { generateSessionId, saveSession, saveSessionSync, flushSessionSaves, sessionTitleFrom, sessionsDir, type SessionData, type ConversationCheckpoint } from '../session/store.js';
import { executeBash } from '../tools/bash.js';
import type { RunInTerminal } from '../tools/nativeTerminal.js';
import { LIMITS, truncateMiddle } from '../tools/truncate.js';
import { uid, messagesToTranscript } from './transcript.js';
import { loadSkills, type SkillDefinition } from '../skills/loader.js';
import { runHooks, type HookEvent, type HookOutcome, type HookPayload } from '../hooks/runner.js';
import { sessionFile } from '../session/store.js';
import { BackgroundTaskManager, describeTask, type BackgroundTask } from '../tools/background.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { CONFIG_DIR_NAME } from '../branding.js';
import { McpManager, type McpServerStatus } from '../mcp/manager.js';
import { loadMcpConfig } from '../mcp/config.js';
import { loadSubagents, type SubagentDefinition } from './subagents.js';
import { runSubagent } from './subagent.js';
import { autoModePrompt, parseVerdict, type AutoVerdict } from '../permissions/autoMode.js';
import { findImagePaths, attachmentFromFile, readAttachmentBase64, type ImageAttachment } from '../utils/imageClipboard.js';
import type { Part } from '@google/genai';
import type {
  ChatMessage,
  ToolCallState,
  AgentStatus,
  PendingConfirmation,
  PermissionDecision,
  PermissionMode,
  TranscriptItem,
  LiveTurn,
  UsageInfo,
  Notice,
  MessageKind,
  TodoItem,
  AgentTask,
} from './types.js';

export interface TurnOptions {
  prompt?: string;
  allow?: string[];
  /** Set when a Stop hook asked to continue: prevents an infinite loop. */
  stopHookActive?: boolean;
  /** Images pasted or dropped into the prompt. */
  attachments?: ImageAttachment[];
  /** A notification for the model (a fork's report): not shown or kept as a user message. */
  hidden?: boolean;
}

/** How long the auto mode classifier may take before the user is asked. */
const AUTO_MODE_TIMEOUT_MS = 30_000;

const PARALLEL_READ_TOOLS = new Set(['read_file', 'list_directory', 'search_files', 'glob']);

function safeLoadMcp(cwd: string) {
  try {
    return loadMcpConfig(cwd);
  } catch {
    return [];
  }
}

function safeLoadSubagents(cwd: string): SubagentDefinition[] {
  try {
    return loadSubagents(cwd);
  } catch {
    return [];
  }
}

function safeLoadSkills(cwd: string): SkillDefinition[] {
  try {
    return loadSkills(cwd);
  } catch {
    return [];
  }
}

export interface AgentCallbacks {
  runInTerminal?: RunInTerminal;
  onStatusChange: (status: AgentStatus) => void;
  onCommit: (item: TranscriptItem) => void;
  onLive: (live: LiveTurn | null) => void;
  onRequestConfirmation: (confirmation: PendingConfirmation | null) => void;
  onUsage: (usage: UsageInfo) => void;
  onNotice: (notice: Notice | null) => void;
  onQueueChange: (queue: string[]) => void;
  onModeChange?: (mode: PermissionMode) => void;
  onNotify?: (event: 'permission' | 'done' | 'error') => void;
  onTodosChange?: (todos: TodoItem[]) => void;
  onBackgroundChange?: (running: number, tasks: BackgroundTask[]) => void;
  /** Background agents changed (started, progressed, finished, deleted). */
  onAgentsChange?: (tasks: AgentTask[]) => void;
  onMcpChange?: (statuses: McpServerStatus[]) => void;
  onTranscriptReset?: (items: TranscriptItem[]) => void;
}

/** Coalesces streamed chunks so the UI re-renders at most every `intervalMs`. */
class ChunkBatcher {
  private buffer = '';
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly emit: (text: string) => void, private readonly intervalMs = 50) {}
  push = (text: string) => {
    this.buffer += text;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.intervalMs);
  };
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.buffer) { const b = this.buffer; this.buffer = ''; this.emit(b); }
  }
}

export class AgentLoop {
  public sessionId: string;
  public readonly createdAt: number;
  private session: GeminiAgentSession;
  private config: AppConfig;
  private messages: ChatMessage[] = [];
  private turnCheckpoints: ConversationCheckpoint[] = [];
  private callbacks: AgentCallbacks;
  private processing = false;
  private stoppedByPermission = false;
  private moveBashToBackground: (() => string | undefined) | undefined;
  private abortController: AbortController | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private checkpointManager: CheckpointManager;
  private queue: Array<{ input: string; kind: MessageKind; options: TurnOptions; shell?: boolean }> = [];
  private pendingContext: string[] = [];
  private rejectConfirmation: (() => void) | null = null;
  private gitBranch?: string;
  private skills: SkillDefinition[] = [];
  private turnAllow: string[] = [];
  private todos: TodoItem[] = [];
  private background: BackgroundTaskManager;
  /** Background agents: /btw then f, or a task typed in the agents view. */
  private agentTasks: AgentTask[] = [];
  /** Auto mode denials, newest first. */
  private recentDenials: Array<{ action: string; reason: string; timestamp: number }> = [];
  private agentControllers = new Map<string, AbortController>();
  private customTitle?: string;
  private mcp: McpManager;
  private subagents: SubagentDefinition[] = [];
  public usage: UsageInfo;

  constructor(config: AppConfig, callbacks: AgentCallbacks, restored?: SessionData) {
    this.config = config;
    this.callbacks = callbacks;
    this.sessionId = restored?.meta.id ?? generateSessionId();
    this.createdAt = restored?.meta.createdAt ?? Date.now();
    this.messages = restored?.messages ?? [];
    this.turnCheckpoints = restored?.turnCheckpoints ?? [];
    this.todos = restored?.todos ?? [];
    this.customTitle = restored?.meta.title && restored.meta.title !== sessionTitleFrom(restored.messages) ? restored.meta.title : undefined;
    this.gitBranch = restored?.meta.gitBranch;
    this.usage = {
      promptTokens: 0,
      responseTokens: 0,
      cumulativeTokens: restored?.meta.tokenCount ?? 0,
      contextWindow: config.contextWindow,
      apiCalls: 0,
      turns: 0,
    };
    this.skills = safeLoadSkills(config.workspaceDir);
    this.subagents = safeLoadSubagents(config.workspaceDir);
    this.session = new GeminiAgentSession(config, restored?.history);
    this.session.setSkills(this.skills);
    this.session.setSubagents(this.subagents);
    this.session.refresh();
    this.checkpointManager = new CheckpointManager(config.workspaceDir);
    this.mcp = new McpManager(safeLoadMcp(config.workspaceDir), {
      onStatus: (statuses) => this.onMcpStatus(statuses),
    });
    if (this.mcp.configured > 0) void this.mcp.connectAll();
    this.background = new BackgroundTaskManager(config.workspaceDir, this.sessionId, (task, tail) => {
      this.addSystemMessage(`⏵ Background task ${task.id} ${task.status}${task.exitCode !== undefined ? ` (exit ${task.exitCode})` : ''} · ${task.description ?? task.command.split('\n')[0].slice(0, 60)}`, 'notice');
      this.pendingContext.push(`[Background task ${task.id} (\`${task.command.split('\n')[0].slice(0, 120)}\`) ${task.status}${task.exitCode !== undefined ? ` with exit code ${task.exitCode}` : ''}. Last output:]\n${tail.trim() || '(no output)'}`);
      this.callbacks.onBackgroundChange?.(this.background.running(), this.background.list());
    });
    void this.fireHooks('SessionStart', { source: restored ? 'resume' : 'startup' }, restored ? 'resume' : 'startup').then((o) => {
      for (const c of o.context) this.pendingContext.push(c);
    });
  }

  // ---------------------------------------------------------------- hooks
  private hasHooks(event: HookEvent): boolean {
    const groups = this.config.settings.hooks?.[event];
    return Array.isArray(groups) && groups.length > 0;
  }

  private async fireHooks(event: HookEvent, extra: Partial<HookPayload> = {}, target?: string): Promise<HookOutcome> {
    const empty: HookOutcome = { blocked: false, reasons: [], context: [], notices: [], ran: 0 };
    if (!this.hasHooks(event)) return empty;
    const payload: HookPayload = {
      session_id: this.sessionId,
      transcript_path: sessionFile(this.config.workspaceDir, this.sessionId),
      cwd: this.config.workspaceDir,
      hook_event_name: event,
      permission_mode: this.config.permissionMode,
      ...extra,
    };
    try {
      const outcome = await runHooks(this.config.settings.hooks, event, payload, { cwd: this.config.workspaceDir }, target);
      for (const n of outcome.notices) this.addSystemMessage(`⚠ ${n}`, 'notice');
      return outcome;
    } catch (err: any) {
      this.addSystemMessage(`⚠ ${event} hook failed: ${err?.message ?? err}`, 'notice');
      return empty;
    }
  }

  public getSkills(): SkillDefinition[] {
    return this.skills;
  }

  public getTodos(): TodoItem[] {
    return this.todos;
  }

  /** Name given with /rename, if any. */
  public get sessionName(): string | undefined { return this.customTitle; }

  public renameSession(title: string) {
    this.customTitle = title.trim() || undefined;
    this.scheduleSave();
  }

  // ---------------------------------------------------------------- MCP
  private onMcpStatus(statuses: McpServerStatus[]) {
    this.session.setExtraTools(this.mcp.getDeclarations());
    this.session.refresh();
    const settled = statuses.filter((s) => s.status !== 'connecting');
    const last = settled[settled.length - 1];
    if (last) {
      this.addSystemMessage(
        last.status === 'connected'
          ? `⚡ MCP ${last.name} connected · ${last.toolCount} tool${last.toolCount === 1 ? '' : 's'}`
          : `⚠ MCP ${last.name} failed: ${last.error ?? 'unknown error'}`,
        'notice'
      );
    }
    this.callbacks.onMcpChange?.(statuses);
  }

  /** Resolves once every configured MCP server has connected or failed. */
  public mcpReady(): Promise<void> {
    return this.mcp.ready();
  }

  public mcpStatuses(): McpServerStatus[] {
    return this.mcp.statuses();
  }

  public mcpTools(): Array<{ server: string; name: string; fullName: string; description?: string }> {
    return this.mcp.getTools();
  }

  public getBackgroundTasks(): BackgroundTask[] {
    return this.background.list();
  }

  public describeBackgroundTasks(): string[] {
    return this.background.list().map(describeTask);
  }

  public killBackgroundTask(id: string): BackgroundTask | undefined {
    const t = this.background.kill(id);
    this.callbacks.onBackgroundChange?.(this.background.running(), this.background.list());
    return t;
  }

  public setTodos(todos: TodoItem[]) {
    this.todos = todos;
    this.callbacks.onTodosChange?.(todos);
    this.scheduleSave();
  }

  /** Re-discover custom commands and skills (system prompt updated, history kept). */
  public reloadSkills(): SkillDefinition[] {
    this.skills = safeLoadSkills(this.config.workspaceDir);
    this.session.setSkills(this.skills);
    this.session.refresh();
    return this.skills;
  }

  public static fromSession(data: SessionData, config: AppConfig, callbacks: AgentCallbacks): AgentLoop {
    return new AgentLoop(config, callbacks, data);
  }

  // ---------------------------------------------------------------- state
  public get busy(): boolean {
    return this.processing;
  }

  public get model(): string {
    return this.config.model;
  }

  public get permissionMode(): PermissionMode {
    return this.config.permissionMode;
  }

  public getMessages(): ChatMessage[] {
    return this.messages;
  }

  public getQueue(): string[] {
    return this.queue.map((entry) => (entry.shell ? '!' : '') + entry.input);
  }

  public popQueue(): string | undefined {
    const last = this.queue.pop();
    this.callbacks.onQueueChange(this.getQueue());
    return last?.input;
  }

  public takeQueue(empty: boolean): { text: string; attachments: ImageAttachment[]; bash: boolean } | undefined {
    const shell = this.queue.length === 1 && this.queue[0].shell && empty;
    const entries = shell ? this.queue.splice(0) : this.queue.filter((entry) => !entry.shell);
    if (!entries.length) return;
    if (!shell) this.queue = this.queue.filter((entry) => entry.shell);
    this.callbacks.onQueueChange(this.getQueue());
    return { text: entries.map((entry) => entry.input).join('\n'), attachments: entries.flatMap((entry) => entry.options.attachments ?? []), bash: !!shell };
  }

  public async sendNow(input: string, attachments: ImageAttachment[] = []): Promise<void> {
    if (input.trim()) {
      if (!this.processing) { await this.handleUserInput(input, 'normal', { attachments }); return; }
      this.queue.push({ input, kind: 'normal', options: { attachments } });
      this.callbacks.onQueueChange(this.getQueue());
    }
    if (this.processing) this.interrupt();
    else this.processQueue();
  }

  public setGitBranch(branch?: string) {
    this.gitBranch = branch;
    this.session.setGitBranch(branch);
  }

  public getCheckpoints(): Checkpoint[] {
    return this.checkpointManager.getCheckpoints();
  }

  public getTurnCheckpoints(): ConversationCheckpoint[] {
    return [...this.turnCheckpoints].reverse();
  }

  /** Files the agent edited in this session (workspace-relative), for the /diff panel. */
  public sessionEditedFiles(): string[] {
    const ids = new Set(this.messages.filter((m) => m.role === 'assistant').map((m) => m.id));
    const files = new Set<string>();
    for (const checkpoint of this.checkpointManager.getCheckpoints()) {
      if (checkpoint.messageId && ids.has(checkpoint.messageId)) for (const file of checkpoint.files) files.add(path.relative(this.config.workspaceDir, path.resolve(this.config.workspaceDir, file.filePath)));
    }
    return [...files];
  }

  /** Files the agent edited during a turn (the prompt of checkpoint `id` and its answer). */
  public turnCodeChanges(id: string): string[] {
    const index = this.turnCheckpoints.findIndex((checkpoint) => checkpoint.id === id);
    if (index < 0) return [];
    const end = this.turnCheckpoints[index + 1]?.messageIndex ?? this.messages.length;
    const ids = new Set(this.messages.slice(this.turnCheckpoints[index].messageIndex, end).filter((m) => m.role === 'assistant').map((m) => m.id));
    const files = new Set<string>();
    for (const checkpoint of this.checkpointManager.getCheckpoints()) {
      if (checkpoint.messageId && ids.has(checkpoint.messageId)) for (const file of checkpoint.files) files.add(file.filePath);
    }
    return [...files];
  }

  public rewindTurn(id: string, scope: 'code' | 'conversation' | 'both'): string[] {
    if (this.processing) throw new Error('Wait for the current turn to finish.');
    const index = this.turnCheckpoints.findIndex((checkpoint) => checkpoint.id === id);
    if (index < 0) throw new Error('Turn checkpoint not found.');
    const checkpoint = this.turnCheckpoints[index];
    const removed = this.messages.slice(checkpoint.messageIndex);
    const assistantIds = new Set(removed.filter((message) => message.role === 'assistant').map((message) => message.id));
    const history = scope === 'conversation' || scope === 'both'
      ? checkpoint.historyFile ? JSON.parse(gunzipSync(fs.readFileSync(checkpoint.historyFile)).toString('utf8')) : checkpoint.history ?? []
      : undefined;
    const files = scope === 'code' || scope === 'both' ? this.checkpointManager.rewindMessageIds(assistantIds) : [];
    if (scope === 'conversation' || scope === 'both') {
      // Claude Code forks the conversation: the version before the rewind stays resumable.
      try {
        const copy = this.getSessionData();
        saveSessionSync({ ...copy, meta: { ...copy.meta, id: generateSessionId() } });
      } catch {}
      this.messages = this.messages.slice(0, checkpoint.messageIndex);
      this.session.initChat(history);
      this.turnCheckpoints = this.turnCheckpoints.slice(0, index);
      this.queue = [];
      this.pendingContext = [];
      this.callbacks.onQueueChange([]);
      this.callbacks.onTranscriptReset?.(messagesToTranscript(this.messages));
      this.usage.promptTokens = 0;
      this.callbacks.onUsage({ ...this.usage });
    }
    this.scheduleSave();
    return files;
  }

  public async summarizeTurn(id: string, scope: 'from' | 'upTo'): Promise<void> {
    if (this.processing) throw new Error('Wait for the current turn to finish.');
    const checkpoint = this.turnCheckpoints.find((item) => item.id === id);
    if (!checkpoint) throw new Error('Turn checkpoint not found.');
    const prefix = checkpoint.historyFile
      ? JSON.parse(gunzipSync(fs.readFileSync(checkpoint.historyFile)).toString('utf8')) as ReturnType<GeminiAgentSession['getHistory']>
      : checkpoint.history ?? [];
    const current = this.session.getHistory();
    const before = current.slice(0, prefix.length);
    const after = current.slice(prefix.length);
    const selected = scope === 'from' ? after : before;
    if (!selected.length) { this.addSystemMessage('Nothing to summarize at this point.', 'notice'); return; }
    this.processing = true;
    this.stoppedByPermission = false;
    this.abortController = new AbortController();
    this.callbacks.onStatusChange('compacting');
    try {
      const summary = await this.session.compactHistory(historyToText(selected), undefined, this.abortController.signal);
      const marker = [
        { role: 'user' as const, parts: [{ text: `[Conversation summary]\n${summary}` }] },
        { role: 'model' as const, parts: [{ text: 'I will continue from this summary.' }] },
      ];
      this.session.initChat(scope === 'from' ? [...before, ...marker] : [...marker, ...after]);
      this.addSystemMessage(`Summarized conversation ${scope === 'from' ? 'from' : 'up to'} the selected prompt.\n${summary}`, 'compact');
    } finally {
      this.processing = false;
      this.abortController = null;
      this.callbacks.onStatusChange('idle');
      this.scheduleSave();
    }
  }

  public rewindTo(id: string): string[] {
    return this.checkpointManager.rewindTo(id);
  }

  public rewindLast(): string[] | null {
    return this.checkpointManager.rewindLast();
  }

  public getSessionData(): SessionData {
    return {
      meta: {
        id: this.sessionId,
        title: this.customTitle ?? sessionTitleFrom(this.messages),
        workspaceDir: this.config.workspaceDir,
        model: this.config.model,
        createdAt: this.createdAt,
        updatedAt: Date.now(),
        messageCount: this.messages.length,
        tokenCount: this.usage.cumulativeTokens,
        gitBranch: this.gitBranch,
      },
      messages: this.messages,
      history: this.session.getHistory(),
      todos: this.todos,
      turnCheckpoints: this.turnCheckpoints,
    };
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.messages.length > 0) void saveSession(this.getSessionData());
    }, 1500);
  }

  /** Persist immediately (used before exit). */
  public async flush(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.messages.length > 0) await saveSession(this.getSessionData());
    await flushSessionSaves();
    if (this.hasHooks('SessionEnd')) {
      await Promise.race([this.fireHooks('SessionEnd', { reason: 'exit' }, 'exit'), new Promise((r) => setTimeout(r, 3000))]);
    }
    this.background.killAll();
    for (const controller of this.agentControllers.values()) controller.abort();
    await this.mcp.close();
  }

  // ---------------------------------------------------------------- settings
  public setPermissionMode(mode: PermissionMode) {
    if (this.config.permissionMode === mode) return;
    this.config.permissionMode = mode;
    this.session.refresh();
    this.callbacks.onModeChange?.(mode);
  }

  public setContextWindow(tokens: number) {
    if (!tokens || tokens === this.usage.contextWindow) return;
    this.config.contextWindow = tokens;
    this.usage.contextWindow = tokens;
    this.callbacks.onUsage({ ...this.usage });
  }

  public switchModel(model: string, thinkingLevel?: import('./thinking.js').ThinkingLevelSetting) {
    this.config.model = model;
    this.config.thinkingLevel = thinkingLevel;
    this.session.switchModel(model, thinkingLevel);
    this.scheduleSave();
  }

  public setThinkingLevel(level?: import('./thinking.js').ThinkingLevelSetting) {
    this.config.thinkingLevel = level;
    this.session.setThinkingLevel(level);
    this.scheduleSave();
  }

  public addSystemMessage(content: string, kind: MessageKind = 'command'): ChatMessage {
    const msg: ChatMessage = { id: uid(), role: 'system', content, kind, timestamp: Date.now() };
    this.messages.push(msg);
    this.callbacks.onCommit({ key: msg.id, kind: 'system', message: msg });
    this.scheduleSave();
    return msg;
  }

  /** Record a local slash command in the transcript without sending it to Gemini. */
  public addCommandMessage(content: string): ChatMessage {
    const msg: ChatMessage = { id: uid(), role: 'user', content, kind: 'command', timestamp: Date.now() };
    this.messages.push(msg);
    this.callbacks.onCommit({ key: msg.id, kind: 'user', message: msg });
    this.scheduleSave();
    return msg;
  }

  public clearHistory() {
    this.interrupt();
    this.queue = [];
    this.callbacks.onQueueChange([]);
    this.messages = [];
    this.turnCheckpoints = [];
    this.pendingContext = [];
    this.setTodos([]);
    this.sessionId = generateSessionId();
    this.session.initChat();
    this.usage = { ...this.usage, promptTokens: 0, responseTokens: 0, cumulativeTokens: 0, apiCalls: 0, turns: 0 };
    this.callbacks.onUsage({ ...this.usage });
  }

  // ---------------------------------------------------------------- control
  public backgroundCurrentBash(): boolean {
    const id = this.moveBashToBackground?.();
    if (!id) return false;
    this.callbacks.onNotice({ level: 'info', text: `Bash continues in background task ${id}` });
    this.callbacks.onBackgroundChange?.(this.background.running(), this.background.list());
    return true;
  }

  public interrupt(): void {
    if (!this.processing) return;
    this.abortController?.abort();
    this.rejectConfirmation?.();
  }

  /**
   * Send a prompt. `options.prompt` is the text really sent to the model when it
   * differs from what is shown (expanded custom command); `options.allow` adds
   * permission rules for this turn only.
   */
  public async handleUserInput(input: string, kind: MessageKind = 'normal', options: TurnOptions = {}): Promise<void> {
    if (this.processing) {
      this.queue.push({ input, kind, options });
      this.callbacks.onQueueChange(this.getQueue());
      return;
    }
    await this.runTurn(input, kind, options);
  }

  private processQueue() {
    if (this.processing || this.queue.length === 0) return;
    const next = this.queue.shift()!;
    this.callbacks.onQueueChange(this.getQueue());
    // Claim the next entry synchronously; no idle window can start a second turn.
    if (next.shell) void this.runShell(next.input);
    else void this.runTurn(next.input, next.kind, next.options);
  }

  private recordUsage(u?: TurnUsage) {
    if (!u) return;
    this.usage.promptTokens = u.promptTokens;
    this.usage.responseTokens = u.responseTokens;
    this.usage.cumulativeTokens += u.totalTokens;
    this.usage.apiCalls++;
    this.callbacks.onUsage({ ...this.usage });
  }

  // ---------------------------------------------------------------- main turn
  private async runTurn(input: string, kind: MessageKind = 'normal', options: TurnOptions = {}): Promise<void> {
    this.processing = true;
    this.stoppedByPermission = false;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const started = Date.now();
    this.turnAllow = options.allow ?? [];
    const checkpointId = uid();
    const historyFile = path.join(sessionsDir(this.config.workspaceDir), 'rewind', this.sessionId, `${checkpointId}.json.gz`);
    fs.mkdirSync(path.dirname(historyFile), { recursive: true });
    fs.writeFileSync(historyFile, gzipSync(JSON.stringify(this.session.getHistory())), { mode: 0o600 });
    if (!options.hidden) this.turnCheckpoints.push({ id: checkpointId, timestamp: started, prompt: input, messageIndex: this.messages.length, historyFile });
    if (this.turnCheckpoints.length > 100) this.turnCheckpoints.shift();

    // Images: explicit attachments (ctrl+v) plus image files named in the prompt (drag & drop, @path).
    const attachments: ImageAttachment[] = [...(options.attachments ?? [])];
    for (const file of findImagePaths(options.prompt ?? input, this.config.workspaceDir)) {
      if (attachments.some((a) => a.path === file)) continue;
      try { attachments.push(attachmentFromFile(file, attachments.length + 1)); } catch (err: any) { this.addSystemMessage(`⚠ ${err.message}`, 'notice'); }
    }
    const userMsg: ChatMessage = {
      id: uid(), role: 'user', content: input, kind, timestamp: started,
      attachments: attachments.length ? attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, bytes: a.bytes })) : undefined,
    };
    if (!options.hidden) {
      this.messages.push(userMsg);
      this.callbacks.onCommit({ key: userMsg.id, kind: 'user', message: userMsg });
    }

    let enriched = resolveMentions(options.prompt ?? input, this.config.workspaceDir, this.config.additionalDirectories);
    if (this.hasHooks('UserPromptSubmit')) {
      const outcome = await this.fireHooks('UserPromptSubmit', { prompt: options.prompt ?? input });
      if (outcome.blocked) {
        this.addSystemMessage(`⛔ Prompt blocked by hook: ${outcome.reasons.join(' · ') || 'no reason given'}`, 'notice');
        this.processing = false;
        this.abortController = null;
        this.turnAllow = [];
        this.callbacks.onStatusChange('idle');
        this.scheduleSave();
        this.processQueue();
        return;
      }
      if (outcome.context.length) enriched = `${outcome.context.join('\n\n')}\n\n${enriched}`;
    }
    if (this.pendingContext.length > 0) {
      enriched = `${this.pendingContext.join('\n\n')}\n\n${enriched}`;
      this.pendingContext = [];
    }

    const assistant: ChatMessage = { id: uid(), role: 'assistant', content: '', parts: [], timestamp: Date.now() };
    this.messages.push(assistant);

    let liveText = '';
    let liveTools: ToolCallState[] = [];
    const emitLive = () => this.callbacks.onLive({ text: liveText, tools: liveTools });
    const batcher = new ChunkBatcher((t) => {
      liveText += t;
      this.callbacks.onStatusChange('streaming');
      emitLive();
    });
    const streamOptions = {
      onChunk: batcher.push,
      signal,
      onAttempt: () => {
        this.callbacks.onNotice(null);
        this.callbacks.onStatusChange('thinking');
      },
      onRetry: (info: { attempt: number; maxAttempts: number; delayMs: number; status?: number }) => {
        this.callbacks.onStatusChange('retrying');
        this.callbacks.onNotice({
          level: 'warn',
          text: `API Error${info.status ? ` (${info.status})` : ''} · Retrying in ${Math.ceil(info.delayMs / 1000)} seconds… (attempt ${info.attempt + 1}/${info.maxAttempts})`,
        });
      },
    };

    const commitText = (content: string) => {
      if (!content) return;
      const part = { type: 'text' as const, id: uid(), content };
      assistant.parts!.push(part);
      this.callbacks.onCommit({ key: part.id, kind: 'text', messageId: assistant.id, content, timestamp: Date.now() });
      liveText = '';
    };

    let toolCount = 0;
    let turns = 0;
    let stopHookContinue = false;
    try {
      this.callbacks.onStatusChange('thinking');
      let message: string | Part[] = enriched;
      if (attachments.length) {
        const imageParts: Part[] = [];
        for (const a of attachments) {
          try { imageParts.push({ inlineData: { mimeType: a.mimeType, data: readAttachmentBase64(a) } }); } catch (err: any) { this.addSystemMessage(`⚠ Cannot read ${a.name}: ${err.message}`, 'notice'); }
        }
        message = [{ text: enriched }, ...imageParts];
      }
      let turn = await this.session.sendUserMessage(message, streamOptions);
      for (;;) {
        batcher.flush();
        this.callbacks.onNotice(null);
        this.recordUsage(turn.usage);
        commitText(turn.text);
        if (turn.functionCalls.length === 0) break;
        turns++;
        this.usage.turns++;
        if (turns > this.config.maxTurns) {
          this.addSystemMessage(`⚠ Max turns reached (${this.config.maxTurns}). Stopping. Ask to continue if needed.`, 'notice');
          break;
        }

        const states: ToolCallState[] = turn.functionCalls.map((c) => ({
          id: c.id || uid(),
          name: c.name,
          args: c.args,
          status: 'pending',
          startTime: Date.now(),
        }));
        liveTools = [...states];
        emitLive();

        const responses: ToolResponsePayload[] = [];
        for (let i = 0; i < states.length;) {
          if (signal.aborted) throw new Error('Interrupted');
          const canParallelize = !this.hasHooks('PreToolUse') && !this.hasHooks('PostToolUse') && !this.hasHooks('PermissionRequest');
          let end = i + 1;
          if (canParallelize && PARALLEL_READ_TOOLS.has(states[i].name)) {
            while (end < states.length && PARALLEL_READ_TOOLS.has(states[end].name)) end++;
          }
          const start = i;
          const batch = states.slice(start, end);
          const outputs = await Promise.all(batch.map((state) => this.executeCall(state, assistant.id, signal, (patch) => {
            Object.assign(state, patch);
            liveTools = states.filter((s) => s.status === 'pending' || s.status === 'confirming' || s.status === 'running');
            emitLive();
          })));
          for (let offset = 0; offset < batch.length; offset++) {
            const state = batch[offset];
            responses.push({ id: turn.functionCalls[start + offset].id, name: state.name, output: outputs[offset] });
            const snapshot = { ...state };
            assistant.parts!.push({ type: 'tool', id: state.id, toolCall: snapshot });
            this.callbacks.onCommit({ key: state.id, kind: 'tool', messageId: assistant.id, toolCall: snapshot });
            toolCount++;
          }
          i = end;
          liveTools = states.slice(i);
          emitLive();
          this.scheduleSave();
        }
        liveTools = [];
        emitLive();
        if (signal.aborted) throw new Error('Interrupted');
        this.callbacks.onStatusChange('thinking');
        turn = await this.session.sendToolResponses(responses, streamOptions);
      }
      assistant.content = assistant.parts!.filter((p) => p.type === 'text').map((p: any) => p.content).join('\n\n');
      this.callbacks.onCommit({
        key: `${assistant.id}-end`,
        kind: 'turn_end',
        messageId: assistant.id,
        durationMs: Date.now() - started,
        toolCount,
        timestamp: Date.now(),
      });
      this.callbacks.onNotify?.('done');
      if (this.hasHooks('Stop')) {
        const outcome = await this.fireHooks('Stop', { stop_hook_active: !!options.stopHookActive });
        if (outcome.blocked && !options.stopHookActive) {
          const reason = outcome.reasons.join(' · ') || 'A Stop hook asked to continue.';
          this.addSystemMessage(`↺ Stop hook: ${reason}`, 'notice');
          this.queue.unshift({ input: `[Stop hook feedback] ${reason}`, kind: 'notice', options: { stopHookActive: true } });
          stopHookContinue = true;
        }
      }
    } catch (err: any) {
      batcher.flush();
      // Clear transient UI before the final error is committed to scrollback.
      this.callbacks.onNotice(null);
      this.callbacks.onLive(null);
      this.callbacks.onRequestConfirmation(null);
      this.callbacks.onStatusChange('idle');
      commitText(liveText);
      if (err?.message === 'Interrupted' || signal.aborted) {
        this.addSystemMessage(this.stoppedByPermission ? 'Permission denied · What should Fuller do instead?' : 'Interrupted · What should Fuller do instead?', 'notice');
        this.session.repairHistory();
      } else {
        const described = describeError(err);
        const hint = /: 404 |not found|no longer available/i.test(described) ? '\nUse /model to pick a model available to your API key.' : /: 429 |quota/i.test(described) ? '\nRate limit or quota reached. Wait and retry, or choose another model with /model.' : '';
        this.addSystemMessage(`✗ ${described}${hint}`, 'notice');
        this.callbacks.onNotify?.('error');
        this.session.repairHistory();
      }
      assistant.content = assistant.parts!.filter((p) => p.type === 'text').map((p: any) => p.content).join('\n\n');
    } finally {
      this.callbacks.onNotice(null);
      this.callbacks.onLive(null);
      this.callbacks.onRequestConfirmation(null);
      this.rejectConfirmation = null;
      this.processing = false;
      this.abortController = null;
      this.turnAllow = [];
      this.callbacks.onStatusChange('idle');
      this.scheduleSave();
    }
    await this.maybeAutoCompact();
    if (stopHookContinue) {
      const next = this.queue.shift()!;
      this.callbacks.onQueueChange(this.getQueue());
      await this.runTurn(next.input, next.kind, next.options);
      return;
    }
    this.processQueue();
  }

  private async executeCall(
    state: ToolCallState,
    messageId: string,
    signal: AbortSignal,
    update: (patch: Partial<ToolCallState>) => void
  ): Promise<string> {
    const { name } = state;
    const label = toolLabel(name);
    if (name === 'exit_plan_mode' && this.config.permissionMode === 'plan') return this.handleExitPlanMode(state, update);
    if (name === 'agent') return this.handleAgentTool(state, messageId, signal, update);
    let approvalComment: string | undefined;
    let hookAllow = false;
    if (this.hasHooks('PreToolUse')) {
      const outcome = await this.fireHooks('PreToolUse', { tool_name: label, tool_input: state.args }, label);
      if (outcome.updatedInput) update({ args: { ...state.args, ...outcome.updatedInput } });
      if (outcome.blocked || outcome.permission === 'deny') {
        const reason = outcome.reasons.join(' · ') || 'blocked by a PreToolUse hook';
        update({ status: 'rejected', error: `Hook: ${reason}`, endTime: Date.now() });
        return `Error: This tool call was blocked by a hook. ${reason}`;
      }
      hookAllow = outcome.permission === 'allow';
      if (outcome.context.length) this.pendingContext.push(...outcome.context);
    }
    const args = state.args;
    const settings = this.turnAllow.length
      ? { ...this.config.settings, permissions: { ...this.config.settings.permissions, allow: [...(this.config.settings.permissions?.allow ?? []), ...this.turnAllow] } }
      : this.config.settings;
    const evaluation = evaluatePermission(name, args, this.config.workspaceDir, this.config.permissionMode, settings);
    const ctx = {
      cwd: this.config.workspaceDir,
      extraDirs: this.config.additionalDirectories,
      checkpointManager: this.checkpointManager,
      signal,
      bashTimeoutMs: this.config.bashTimeoutMs,
      messageId,
      skills: this.skills,
      setTodos: (todos: TodoItem[]) => this.setTodos(todos),
      background: this.background,
      runInTerminal: this.callbacks.runInTerminal,
      onBackgroundReady: (move: (() => string | undefined) | undefined) => { this.moveBashToBackground = move; },
      onOutput: (chunk: string) => {
        const current = (state.result ?? '') + chunk;
        update({ result: current.length > 4000 ? current.slice(-4000) : current });
      },
      outputFile: name === 'execute_bash' ? path.join(sessionsDir(this.config.workspaceDir), 'outputs', this.sessionId, `${state.id}.log`) : undefined,
    };

    if (name === 'edit_file' || name === 'write_file') {
      const preview = await previewTool(name, state.args, ctx);
      if (preview.error) {
        update({ status: 'failed', error: preview.error, endTime: Date.now() });
        return `Error: ${preview.error}`;
      }
      update({ diff: preview.diff });
    }

    if (evaluation.decision === 'deny') {
      const reason = evaluation.reason === 'plan mode'
        ? `Plan mode is active: ${toolLabel(name)} is not allowed. Present your plan and wait for the user to exit plan mode (shift+tab).`
        : `This tool call was denied by a permission rule${evaluation.matchedRule ? ` (${evaluation.matchedRule})` : ''}.`;
      update({ status: 'rejected', error: reason, endTime: Date.now() });
      return `Error: ${reason}`;
    }

    let decisionOverride: PermissionDecision | null = null;
    if (evaluation.decision === 'ask' && hookAllow) decisionOverride = { kind: 'yes' };
    if (evaluation.decision === 'ask' && !decisionOverride && this.config.permissionMode === 'auto') {
      update({ summary: 'auto mode: checking…' });
      const verdict = await this.autoDecide(state, evaluation, signal);
      if (verdict?.decision === 'allow') decisionOverride = { kind: 'yes' };
      else if (verdict?.decision === 'deny') {
        const error = `Denied by auto mode · ${verdict.reason}`;
        update({ status: 'rejected', error, summary: undefined, endTime: Date.now() });
        return `Error: auto mode denied this tool call: ${verdict.reason}. Do not retry it; find another way or ask the user to run it or to switch modes (shift+tab).`;
      }
      update({ summary: undefined });
    }
    if (evaluation.decision === 'ask' && !decisionOverride && this.hasHooks('PermissionRequest')) {
      const outcome = await this.fireHooks('PermissionRequest', { tool_name: label, tool_input: args }, label);
      if (outcome.updatedInput) update({ args: { ...state.args, ...outcome.updatedInput } });
      if (outcome.blocked || outcome.permission === 'deny') decisionOverride = { kind: 'no', feedback: outcome.reasons.join(' · ') || 'denied by a PermissionRequest hook' };
      else if (outcome.permission === 'allow') decisionOverride = { kind: 'yes' };
    }

    if (evaluation.decision === 'ask') {
      if (!decisionOverride) {
        update({ status: 'confirming' });
        this.callbacks.onStatusChange('awaiting_permission');
        this.callbacks.onNotify?.('permission');
        void this.fireHooks('Notification', { message: `Fuller needs your permission to use ${label}`, notification_type: 'permission_prompt' }, 'permission_prompt');
      }
      const decision = decisionOverride ?? await this.askPermission(state, evaluation);
      if (decision.kind === 'yes') approvalComment = decision.feedback;
      if (decision.kind === 'always') {
        const option = evaluation.options.find((o) => o.value === 'always');
        if (option?.switchMode) this.setPermissionMode(option.switchMode);
        else if (decision.rule) {
          const rules = decision.rules?.length ? decision.rules : [decision.rule];
          let file = '';
          for (const rule of rules) file = addPermissionRule(this.config.workspaceDir, rule);
          this.config.settings.permissions = {
            ...this.config.settings.permissions,
            allow: [...(this.config.settings.permissions?.allow ?? []), ...rules],
          };
          this.callbacks.onNotice({ level: 'info', text: `${rules.length > 1 ? 'Rules' : 'Rule'} added: ${rules.join(', ')} → ${file}` });
          setTimeout(() => this.callbacks.onNotice(null), 4000);
        }
      }
      if (decision.kind === 'no') {
        const error = decision.feedback ? `Rejected · ${decision.feedback}` : 'Rejected by user';
        update({ status: 'rejected', error, endTime: Date.now() });
        if (!decisionOverride && !decision.feedback?.trim()) {
          this.stoppedByPermission = true;
          this.interrupt();
        }
        return `Error: The user declined this tool call.${decision.feedback ? ` The user said: "${decision.feedback}".` : ''} Do not retry the same call; adapt your approach or ask the user.`;
      }
    }

    update({ status: 'running' });
    this.callbacks.onStatusChange('running_tool');
    try {
      const out = name.startsWith('mcp__') && this.mcp.hasTool(name)
        ? await this.mcp.callTool(name, state.args, signal)
        : await dispatchTool(name, state.args, ctx);
      update({ status: 'completed', result: out.output, outputFile: 'outputFile' in out && typeof out.outputFile === 'string' ? out.outputFile : undefined, summary: out.summary, diff: (out as any).diff ?? state.diff, endTime: Date.now() });
      if (name === 'execute_bash' && state.args.run_in_background) this.callbacks.onBackgroundChange?.(this.background.running(), this.background.list());
      let output = out.output;
      if (approvalComment) output += `\n\n[User comment on this approval]\n${approvalComment}`;
      if (this.hasHooks('PostToolUse')) {
        const outcome = await this.fireHooks('PostToolUse', { tool_name: label, tool_input: state.args, tool_response: { output: out.output.slice(0, 4000), summary: out.summary } }, label);
        const extra = [...(outcome.blocked ? [`[Hook feedback] ${outcome.reasons.join(' · ')}`] : []), ...outcome.context];
        if (extra.length) output += `\n\n${extra.join('\n\n')}`;
      }
      return output;
    } catch (err: any) {
      if (err?.message === 'Interrupted' || signal.aborted) throw new Error('Interrupted');
      const message = err?.message || String(err);
      update({ status: 'failed', error: message, endTime: Date.now() });
      return `Error: ${message}`;
    }
  }

  public getSubagents(): SubagentDefinition[] {
    return this.subagents;
  }

  /** The `agent` tool: run a subagent with the parent's permissions and stream its progress into the tool row. */
  private async handleAgentTool(state: ToolCallState, messageId: string, signal: AbortSignal, update: (patch: Partial<ToolCallState>) => void): Promise<string> {
    const type = String(state.args.subagent_type ?? 'general-purpose');
    const definition = this.subagents.find((d) => d.name === type) ?? this.subagents.find((d) => d.name.toLowerCase() === type.toLowerCase());
    if (!definition) {
      const known = this.subagents.map((d) => d.name).join(', ');
      update({ status: 'failed', error: `Unknown subagent type "${type}"`, endTime: Date.now() });
      return `Error: unknown subagent type "${type}". Available: ${known}.`;
    }
    const prompt = String(state.args.prompt ?? '').trim();
    if (!prompt) {
      update({ status: 'failed', error: 'prompt is required', endTime: Date.now() });
      return 'Error: provide a prompt for the subagent.';
    }
    update({ status: 'running', summary: `${definition.name}` });
    this.callbacks.onStatusChange('running_tool');
    try {
      const result = await runSubagent({
        config: this.config,
        definition,
        prompt,
        description: String(state.args.description ?? definition.name),
        signal,
        skills: this.skills,
        askPermission: async (st, ev) => {
          const auto = this.config.permissionMode === 'auto' ? await this.autoDecide(st, ev, signal) : null;
          if (auto) return auto.decision === 'allow' ? { kind: 'yes' } : { kind: 'no', feedback: `auto mode denied it: ${auto.reason}` };
          this.callbacks.onStatusChange('awaiting_permission');
          this.callbacks.onNotify?.('permission');
          return this.askPermission(st, ev).finally(() => this.callbacks.onStatusChange('running_tool'));
        },
        onProgress: (log, toolCount) => update({ result: log, summary: `${definition.name} · ${toolCount} tool use${toolCount === 1 ? '' : 's'}` }),
        onUsage: (u) => { this.usage.cumulativeTokens += u.totalTokens; this.usage.apiCalls++; this.callbacks.onUsage({ ...this.usage }); },
        checkpointManager: this.checkpointManager,
        background: this.background,
        runInTerminal: this.callbacks.runInTerminal,
        messageId,
      });
      const summary = `Done · ${result.toolCount} tool use${result.toolCount === 1 ? '' : 's'} · ${result.turns} turn${result.turns === 1 ? '' : 's'} · ${result.tokens.toLocaleString('en-US')} tokens`;
      update({ status: 'completed', result: result.text, summary, endTime: Date.now() });
      return `[${definition.name} subagent report — ${summary}]\n\n${result.text}`;
    } catch (err: any) {
      if (err?.message === 'Interrupted' || signal.aborted) throw new Error('Interrupted');
      const message = err?.message ?? String(err);
      update({ status: 'failed', error: message, endTime: Date.now() });
      return `Error: subagent failed: ${message}`;
    }
  }

  /** Plan mode: show the plan, ask the user to approve it, and switch modes accordingly. */
  private async handleExitPlanMode(state: ToolCallState, update: (patch: Partial<ToolCallState>) => void): Promise<string> {
    const plan = String(state.args.plan ?? '').trim();
    if (!plan) {
      update({ status: 'failed', error: 'plan is required', endTime: Date.now() });
      return 'Error: provide the plan text.';
    }
    // The plan itself goes into the transcript so the user can read it in full.
    this.callbacks.onCommit({ key: `${state.id}-plan`, kind: 'text', messageId: state.id, content: `**Plan**\n\n${plan}`, timestamp: Date.now() });
    let planFile = '';
    try {
      const dir = path.join(os.homedir(), CONFIG_DIR_NAME, 'plans');
      fs.mkdirSync(dir, { recursive: true });
      planFile = path.join(dir, `${this.sessionId}.md`);
      fs.writeFileSync(planFile, `${plan}\n`, 'utf8');
    } catch {}
    update({ status: 'confirming' });
    this.callbacks.onStatusChange('awaiting_permission');
    this.callbacks.onNotify?.('permission');
    const decision = await new Promise<PermissionDecision>((resolve, reject) => {
      this.rejectConfirmation = () => {
        this.rejectConfirmation = null;
        this.callbacks.onRequestConfirmation(null);
        reject(new Error('Interrupted'));
      };
      this.callbacks.onRequestConfirmation({
        toolCall: state,
        title: 'Would you like to proceed?',
        options: [
          { value: 'yes', label: 'Yes, and auto-accept edits', switchMode: 'acceptEdits' },
          { value: 'always', label: 'Yes, manually approve edits', switchMode: 'default' },
          { value: 'no', label: 'No, keep planning' },
        ],
        onDecide: (d) => {
          this.rejectConfirmation = null;
          this.callbacks.onRequestConfirmation(null);
          resolve(d);
        },
      });
    });
    if (decision.kind === 'no') {
      update({ status: 'rejected', error: decision.feedback ? `Keep planning · ${decision.feedback}` : 'Keep planning', endTime: Date.now() });
      return `The user did not approve the plan${decision.feedback ? `: "${decision.feedback}"` : ''}. Stay in plan mode, revise the plan accordingly and call exit_plan_mode again.`;
    }
    const mode: PermissionMode = decision.kind === 'yes' ? 'acceptEdits' : 'default';
    this.setPermissionMode(mode);
    update({ status: 'completed', summary: `approved · ${mode}`, result: `Plan approved (${mode})${planFile ? ` · ${planFile}` : ''}`, endTime: Date.now() });
    return `The user approved the plan. Plan mode is off (permission mode: ${mode}${mode === 'acceptEdits' ? ', file edits are auto-accepted' : ', edits need approval'}). Implement the plan now, step by step.`;
  }

  /**
   * Auto mode: a model call decides instead of the user. Dangerous actions are
   * always denied; ask rules still prompt; if the classifier fails, the user is
   * asked (null). Denials are kept for /permissions → Recently denied.
   */
  private async autoDecide(state: ToolCallState, evaluation: Evaluation, signal?: AbortSignal): Promise<AutoVerdict | null> {
    if (evaluation.matchedRule && (this.config.settings.permissions?.ask ?? []).includes(evaluation.matchedRule)) return null;
    const action = `${evaluation.displayName}(${evaluation.target})`;
    let verdict: AutoVerdict | null;
    if (evaluation.risk === 'danger') verdict = { decision: 'deny', reason: `Hard deny: ${evaluation.reason}` };
    else {
      try {
        const userRequests = this.messages.filter((m) => m.role === 'user' && m.kind !== 'command').map((m) => m.content);
        // A slow classifier (retries on an overloaded API) must not stall the turn: after 30 s the user decides.
        const limit = new AbortController();
        const timer = setTimeout(() => limit.abort(), AUTO_MODE_TIMEOUT_MS);
        const relay = () => limit.abort();
        signal?.addEventListener('abort', relay);
        try {
          const text = await this.session.oneShot(autoModePrompt({ action, risk: `${evaluation.risk} · ${evaluation.reason}`, userRequests, settings: this.config.settings.autoMode }), undefined, limit.signal, false, true);
          verdict = parseVerdict(text);
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', relay);
        }
      } catch (err: any) {
        if (signal?.aborted) throw new Error('Interrupted');
        this.callbacks.onNotice({ level: 'warn', text: `Auto mode could not decide (${err?.message === 'Interrupted' ? 'no answer in 30 s' : describeError(err)}) — asking you instead.` });
        setTimeout(() => this.callbacks.onNotice(null), 5000);
        return null;
      }
    }
    if (verdict.decision === 'deny') {
      this.recentDenials.unshift({ action, reason: verdict.reason, timestamp: Date.now() });
      this.recentDenials = this.recentDenials.slice(0, 50);
    }
    return verdict;
  }

  public getRecentDenials(): Array<{ action: string; reason: string; timestamp: number }> {
    return [...this.recentDenials];
  }

  private askPermission(state: ToolCallState, evaluation: Evaluation): Promise<PermissionDecision> {
    return new Promise<PermissionDecision>((resolve, reject) => {
      this.rejectConfirmation = () => {
        this.rejectConfirmation = null;
        this.callbacks.onRequestConfirmation(null);
        reject(new Error('Interrupted'));
      };
      this.callbacks.onRequestConfirmation({
        toolCall: state,
        title: evaluation.title,
        options: evaluation.options,
        danger: evaluation.danger,
        onDecide: (decision) => {
          this.rejectConfirmation = null;
          this.callbacks.onRequestConfirmation(null);
          resolve(decision);
        },
      });
    });
  }

  // ---------------------------------------------------------------- shell mode ("!")
  public async runShell(command: string): Promise<void> {
    if (this.processing) {
      this.queue.push({ input: command, kind: 'bash', options: {}, shell: true });
      this.callbacks.onQueueChange(this.getQueue());
      return;
    }
    this.processing = true;
    this.stoppedByPermission = false;
    this.abortController = new AbortController();
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: command, kind: 'bash', timestamp: Date.now() };
    this.messages.push(userMsg);
    this.callbacks.onCommit({ key: userMsg.id, kind: 'user', message: userMsg });
    const state: ToolCallState = { id: uid(), name: 'execute_bash', args: { command }, status: 'running', startTime: Date.now(), origin: 'user' };
    let shellReport: string | null = null;
    this.callbacks.onLive({ text: '', tools: [state] });
    this.callbacks.onStatusChange('running_tool');
    try {
      const res = await executeBash(command, this.config.workspaceDir, { timeoutMs: this.config.bashTimeoutMs, signal: this.abortController.signal, background: this.background, runInTerminal: this.callbacks.runInTerminal, onBackgroundReady: (move) => { this.moveBashToBackground = move; }, outputFile: path.join(sessionsDir(this.config.workspaceDir), 'outputs', this.sessionId, `${state.id}.log`) });
      const output = res.backgroundTaskId ? `Command continues as background task ${res.backgroundTaskId}.` : [res.stdout, res.stderr ? `[stderr]\n${res.stderr}` : ''].filter(Boolean).join('\n') || '(no output)';
      const finished: ToolCallState = {
        ...state,
        status: res.exitCode === 0 ? 'completed' : 'failed',
        result: truncateMiddle(output, LIMITS.bashOutput),
        outputFile: res.backgroundTaskId ? undefined : res.outputFile,
        error: res.exitCode === 0 ? undefined : `exit ${res.exitCode}`,
        summary: res.backgroundTaskId ? `background ${res.backgroundTaskId}` : `${res.durationMs}ms`,
        endTime: Date.now(),
      };
      const assistant: ChatMessage = { id: uid(), role: 'assistant', content: '', parts: [{ type: 'tool', id: finished.id, toolCall: finished }], kind: 'bash', timestamp: Date.now() };
      this.messages.push(assistant);
      this.callbacks.onLive(null);
      this.callbacks.onCommit({ key: finished.id, kind: 'tool', messageId: assistant.id, toolCall: finished });
      shellReport = `[The user ran this shell command themselves: \`${command}\` (exit ${res.exitCode})]\n${truncateMiddle(output, 10_000)}`;
      if (res.backgroundTaskId || this.config.settings.replyAfterShell === false) { this.pendingContext.push(shellReport); shellReport = null; }
    } catch (err: any) {
      this.addSystemMessage(`✗ ${err.message || String(err)}`, 'notice');
    } finally {
      this.callbacks.onLive(null);
      this.processing = false;
      this.abortController = null;
      this.callbacks.onStatusChange('idle');
      this.scheduleSave();
      // Claude Code has the model answer a `!` command at once; queued prompts go first and carry it.
      if (shellReport && this.queue.length === 0) void this.runTurn(shellReport, 'normal', { hidden: true });
      else { if (shellReport) this.pendingContext.push(shellReport); this.processQueue(); }
    }
  }

  // ---------------------------------------------------------------- side chat ("/btw")
  /**
   * /btw: answer a side question with the session's context, without adding it
   * to the conversation or blocking the current turn (Claude Code's panel).
   */
  public async askAside(question: string, onChunk: (text: string) => void, signal: AbortSignal): Promise<string> {
    return this.session.oneShot(`${question}\n\n(Side question: answer briefly. Do not use tools.)`, onChunk, signal, true);
  }

  /**
   * /btw then f: Claude Code forks the conversation into a background agent
   * that works on the side question ("⑂ forked reply-with-the (d853)"). When
   * it finishes, "● Agent "…" finished · 2s" appears and its report is handed
   * to the model, which answers at once when idle.
   */
  public forkAside(question: string): void {
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: `/btw ${question}`, kind: 'command', timestamp: Date.now() };
    this.messages.push(userMsg);
    this.callbacks.onCommit({ key: userMsg.id, kind: 'user', message: userMsg });
    this.startBackgroundAgent(question, true);
  }

  /** A new agent from the agents view (←): a fresh context, reported only in that view. */
  public startAgent(task: string): void {
    this.startBackgroundAgent(task, false);
  }

  public getAgentTasks(): AgentTask[] {
    return this.agentTasks.map((task) => ({ ...task }));
  }

  /** ctrl+x in the agents view: stops the agent if it still works and forgets it. */
  public deleteAgentTask(id: string): void {
    this.agentControllers.get(id)?.abort();
    this.agentTasks = this.agentTasks.filter((task) => task.id !== id);
    this.callbacks.onAgentsChange?.(this.getAgentTasks());
  }

  private startBackgroundAgent(task: string, fork: boolean): void {
    const definition = this.subagents.find((d) => d.name === 'general-purpose') ?? this.subagents[0];
    if (!definition) { this.addSystemMessage('✗ No agent available', 'notice'); return; }
    const slug = task.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').trim().split(/\s+/).slice(0, 3).join('-') || 'agent';
    const id = Math.random().toString(16).slice(2, 6);
    if (fork) this.addSystemMessage(`{{text:⑂ forked ${slug} (${id})}}`, 'notice');
    const record: AgentTask = { id, title: task, status: 'working', startedAt: Date.now() };
    this.agentTasks.push(record);
    const controller = new AbortController();
    this.agentControllers.set(id, controller);
    this.callbacks.onAgentsChange?.(this.getAgentTasks());
    const settle = (patch: Partial<AgentTask>) => {
      Object.assign(record, patch, { endedAt: Date.now() });
      this.callbacks.onAgentsChange?.(this.getAgentTasks());
    };
    void runSubagent({
      config: this.config,
      definition,
      prompt: task,
      description: task,
      signal: controller.signal,
      skills: this.skills,
      history: fork ? this.session.getHistory() : undefined,
      askPermission: async (st, ev) => {
        const auto = this.config.permissionMode === 'auto' ? await this.autoDecide(st, ev, controller.signal) : null;
        if (auto) return auto.decision === 'allow' ? { kind: 'yes' } : { kind: 'no', feedback: `auto mode denied it: ${auto.reason}` };
        this.callbacks.onNotify?.('permission');
        return this.askPermission(st, ev);
      },
      onProgress: (log) => { record.progress = log.split('\n').pop(); this.callbacks.onAgentsChange?.(this.getAgentTasks()); },
      onUsage: (u) => { this.usage.cumulativeTokens += u.totalTokens; this.usage.apiCalls++; this.callbacks.onUsage({ ...this.usage }); },
      checkpointManager: this.checkpointManager,
      background: this.background,
      runInTerminal: this.callbacks.runInTerminal,
    }).then((result) => {
      settle({ status: 'completed', report: result.text });
      if (!fork) return;
      const seconds = Math.max(1, Math.round((record.endedAt! - record.startedAt) / 1000));
      this.addSystemMessage(`{{success:●}} Agent "${task}" finished {{subtle:· ${seconds}s}}`, 'event');
      this.notifyFromFork(`[Forked agent ${id} finished the side question "${task}". Its report:]\n${result.text || '(empty report)'}`);
    }).catch((err: any) => {
      if (controller.signal.aborted) return;
      settle({ status: 'failed', report: err?.message ?? String(err) });
      if (fork) this.addSystemMessage(`{{error:●}} Agent "${task}" failed {{subtle:· ${err?.message ?? err}}}`, 'event');
    }).finally(() => this.agentControllers.delete(id));
  }

  /** Hands a fork's report to the model: at once when idle, else with the next turn. */
  private notifyFromFork(text: string): void {
    if (this.processing) { this.pendingContext.push(text); return; }
    void this.runTurn(text, 'normal', { hidden: true });
  }

  public async sideChat(question: string): Promise<void> {
    if (this.processing) {
      this.callbacks.onNotice({ level: 'warn', text: 'Fuller is busy — wait for the current turn to finish.' });
      return;
    }
    this.processing = true;
    this.stoppedByPermission = false;
    this.abortController = new AbortController();
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: `/btw ${question}`, kind: 'command', timestamp: Date.now() };
    this.messages.push(userMsg);
    this.callbacks.onCommit({ key: userMsg.id, kind: 'user', message: userMsg });
    let text = '';
    const batcher = new ChunkBatcher((t) => {
      text += t;
      this.callbacks.onStatusChange('streaming');
      this.callbacks.onLive({ text, tools: [] });
    });
    try {
      this.callbacks.onStatusChange('thinking');
      await this.session.oneShot(question, batcher.push, this.abortController.signal);
      batcher.flush();
      const msg: ChatMessage = { id: uid(), role: 'assistant', content: text, kind: 'command', timestamp: Date.now() };
      this.messages.push(msg);
      this.callbacks.onCommit({ key: msg.id, kind: 'text', messageId: msg.id, content: text || '(no answer)', timestamp: msg.timestamp });
    } catch (err: any) {
      batcher.flush();
      this.addSystemMessage(err?.message === 'Interrupted' ? 'Interrupted' : `✗ ${describeError(err)}`, 'notice');
    } finally {
      this.callbacks.onLive(null);
      this.processing = false;
      this.abortController = null;
      this.callbacks.onStatusChange('idle');
      this.scheduleSave();
      this.processQueue();
    }
  }

  // ---------------------------------------------------------------- compaction
  public async compact(focus?: string, auto = false): Promise<void> {
    if (this.processing) {
      this.callbacks.onNotice({ level: 'warn', text: 'Fuller is busy — try /compact again when the turn is finished.' });
      return;
    }
    const history = this.session.getHistory();
    if (history.length < 2) {
      this.addSystemMessage('✗ Error: No messages to compact', 'notice');
      return;
    }
    if (this.hasHooks('PreCompact')) {
      const outcome = await this.fireHooks('PreCompact', { trigger: auto ? 'auto' : 'manual' }, auto ? 'auto' : 'manual');
      if (outcome.blocked) {
        this.addSystemMessage(`⛔ Compaction blocked by hook: ${outcome.reasons.join(' · ')}`, 'notice');
        return;
      }
    }
    this.processing = true;
    this.stoppedByPermission = false;
    this.abortController = new AbortController();
    this.callbacks.onStatusChange('compacting');
    try {
      const text = historyToText(history);
      const summary = await this.session.compactHistory(text, focus, this.abortController.signal);
      this.session.resetWithSummary(summary);
      const msg: ChatMessage = { id: uid(), role: 'system', kind: 'compact', content: summary, timestamp: Date.now() };
      this.messages.push(msg);
      this.callbacks.onCommit({ key: msg.id, kind: 'system', message: msg });
      this.usage.promptTokens = Math.round(summary.length / 4);
      this.callbacks.onUsage({ ...this.usage });
    } catch (err: any) {
      this.addSystemMessage(err?.message === 'Interrupted' ? 'Compaction interrupted.' : `✗ Compaction failed: ${describeError(err)}`, 'notice');
    } finally {
      this.processing = false;
      this.abortController = null;
      this.callbacks.onStatusChange('idle');
      this.scheduleSave();
      if (!auto) this.processQueue();
    }
  }

  private async maybeAutoCompact(): Promise<void> {
    if (!this.config.autoCompact) return;
    const ratio = this.usage.promptTokens / this.usage.contextWindow;
    if (ratio < this.config.autoCompactThreshold) return;
    this.addSystemMessage(`Context is ${Math.round(ratio * 100)}% full — compacting conversation…`, 'notice');
    await this.compact(undefined, true);
  }
}
