import { GeminiAgentSession, historyToText, type ToolResponsePayload, type TurnUsage } from './gemini.js';
import { dispatchTool, previewTool, toolLabel } from '../tools/registry.js';
import { evaluatePermission, type Evaluation } from '../permissions/rules.js';
import { addPermissionRule, type AppConfig } from '../config.js';
import { resolveMentions } from '../utils/mentions.js';
import { describeError } from './retry.js';
import { CheckpointManager, type Checkpoint } from '../checkpoint/manager.js';
import { generateSessionId, saveSession, flushSessionSaves, sessionTitleFrom, type SessionData } from '../session/store.js';
import { executeBash } from '../tools/bash.js';
import { LIMITS, truncateMiddle } from '../tools/truncate.js';
import { uid } from './transcript.js';
import { loadSkills, type SkillDefinition } from '../skills/loader.js';
import { runHooks, type HookEvent, type HookOutcome, type HookPayload } from '../hooks/runner.js';
import { sessionFile } from '../session/store.js';
import { BackgroundTaskManager, describeTask, type BackgroundTask } from '../tools/background.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CONFIG_DIR_NAME } from '../branding.js';
import { McpManager, type McpServerStatus } from '../mcp/manager.js';
import { loadMcpConfig } from '../mcp/config.js';
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
} from './types.js';

export interface TurnOptions {
  prompt?: string;
  allow?: string[];
  /** Set when a Stop hook asked to continue: prevents an infinite loop. */
  stopHookActive?: boolean;
}

function safeLoadMcp(cwd: string) {
  try {
    return loadMcpConfig(cwd);
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
  onMcpChange?: (statuses: McpServerStatus[]) => void;
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
  private callbacks: AgentCallbacks;
  private processing = false;
  private abortController: AbortController | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private checkpointManager: CheckpointManager;
  private queue: string[] = [];
  private pendingContext: string[] = [];
  private rejectConfirmation: (() => void) | null = null;
  private gitBranch?: string;
  private skills: SkillDefinition[] = [];
  private turnAllow: string[] = [];
  private todos: TodoItem[] = [];
  private background: BackgroundTaskManager;
  private customTitle?: string;
  private mcp: McpManager;
  public usage: UsageInfo;

  constructor(config: AppConfig, callbacks: AgentCallbacks, restored?: SessionData) {
    this.config = config;
    this.callbacks = callbacks;
    this.sessionId = restored?.meta.id ?? generateSessionId();
    this.createdAt = restored?.meta.createdAt ?? Date.now();
    this.messages = restored?.messages ?? [];
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
    this.session = new GeminiAgentSession(config, restored?.history);
    this.session.setSkills(this.skills);
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
    return [...this.queue];
  }

  public popQueue(): string | undefined {
    const last = this.queue.pop();
    this.callbacks.onQueueChange([...this.queue]);
    return last;
  }

  public setGitBranch(branch?: string) {
    this.gitBranch = branch;
    this.session.setGitBranch(branch);
  }

  public getCheckpoints(): Checkpoint[] {
    return this.checkpointManager.getCheckpoints();
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

  public switchModel(model: string) {
    this.config.model = model;
    this.session.switchModel(model);
    this.scheduleSave();
  }

  public addSystemMessage(content: string, kind: MessageKind = 'command'): ChatMessage {
    const msg: ChatMessage = { id: uid(), role: 'system', content, kind, timestamp: Date.now() };
    this.messages.push(msg);
    this.callbacks.onCommit({ key: msg.id, kind: 'system', message: msg });
    this.scheduleSave();
    return msg;
  }

  public clearHistory() {
    this.interrupt();
    this.queue = [];
    this.callbacks.onQueueChange([]);
    this.messages = [];
    this.pendingContext = [];
    this.setTodos([]);
    this.sessionId = generateSessionId();
    this.session.initChat();
    this.usage = { ...this.usage, promptTokens: 0, responseTokens: 0, cumulativeTokens: 0, apiCalls: 0, turns: 0 };
    this.callbacks.onUsage({ ...this.usage });
  }

  // ---------------------------------------------------------------- control
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
      this.queue.push(input);
      this.callbacks.onQueueChange([...this.queue]);
      return;
    }
    await this.runTurn(input, kind, options);
  }

  private processQueue() {
    if (this.processing || this.queue.length === 0) return;
    const next = this.queue.shift()!;
    this.callbacks.onQueueChange([...this.queue]);
    setImmediate(() => void this.runTurn(next));
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
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const started = Date.now();
    this.turnAllow = options.allow ?? [];

    const userMsg: ChatMessage = { id: uid(), role: 'user', content: input, kind, timestamp: started };
    this.messages.push(userMsg);
    this.callbacks.onCommit({ key: userMsg.id, kind: 'user', message: userMsg });

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
      onRetry: (info: { attempt: number; maxAttempts: number; delayMs: number; status?: number }) => {
        this.callbacks.onNotice({
          level: 'warn',
          text: `API Error${info.status ? ` (${info.status})` : ''} · Retrying in ${Math.round(info.delayMs / 1000)} seconds… (attempt ${info.attempt}/${info.maxAttempts})`,
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
      let turn = await this.session.sendUserMessage(enriched, streamOptions);
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
        for (let i = 0; i < states.length; i++) {
          if (signal.aborted) throw new Error('Interrupted');
          const state = states[i];
          const update = (patch: Partial<ToolCallState>) => {
            Object.assign(state, patch);
            liveTools = states.slice(i);
            emitLive();
          };
          const output = await this.executeCall(state, assistant.id, signal, update);
          responses.push({ id: turn.functionCalls[i].id, name: state.name, output });
          const snapshot = { ...state };
          assistant.parts!.push({ type: 'tool', id: state.id, toolCall: snapshot });
          liveTools = states.slice(i + 1);
          emitLive();
          this.callbacks.onCommit({ key: state.id, kind: 'tool', messageId: assistant.id, toolCall: snapshot });
          toolCount++;
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
          this.queue.unshift(`[Stop hook feedback] ${reason}`);
          stopHookContinue = true;
        }
      }
    } catch (err: any) {
      batcher.flush();
      commitText(liveText);
      if (err?.message === 'Interrupted' || signal.aborted) {
        this.addSystemMessage('Interrupted · What should Fuller do instead?', 'notice');
        this.session.repairHistory();
      } else {
        const described = describeError(err);
        const hint = /\(404\)|not found|no longer available/i.test(described) ? '\nUse /model to pick a model available to your API key.' : /\(429\)|quota/i.test(described) ? '\nQuota exhausted for this model — try another one with /model.' : '';
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
      this.callbacks.onQueueChange([...this.queue]);
      await this.runTurn(next, 'notice', { stopHookActive: true });
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
      onOutput: (chunk: string) => {
        const current = (state.result ?? '') + chunk;
        update({ result: current.length > 4000 ? current.slice(-4000) : current });
      },
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
      if (decision.kind === 'always') {
        const option = evaluation.options.find((o) => o.value === 'always');
        if (option?.switchMode) this.setPermissionMode(option.switchMode);
        else if (decision.rule) {
          const file = addPermissionRule(this.config.workspaceDir, decision.rule);
          this.config.settings.permissions = {
            ...this.config.settings.permissions,
            allow: [...(this.config.settings.permissions?.allow ?? []), decision.rule],
          };
          this.callbacks.onNotice({ level: 'info', text: `Rule added: ${decision.rule} → ${file}` });
          setTimeout(() => this.callbacks.onNotice(null), 4000);
        }
      }
      if (decision.kind === 'no') {
        const error = decision.feedback ? `Rejected · ${decision.feedback}` : 'Rejected by user';
        update({ status: 'rejected', error, endTime: Date.now() });
        return `Error: The user declined this tool call.${decision.feedback ? ` The user said: "${decision.feedback}".` : ''} Do not retry the same call; adapt your approach or ask the user.`;
      }
    }

    update({ status: 'running' });
    this.callbacks.onStatusChange('running_tool');
    try {
      const out = name.startsWith('mcp__') && this.mcp.hasTool(name)
        ? await this.mcp.callTool(name, state.args, signal)
        : await dispatchTool(name, state.args, ctx);
      update({ status: 'completed', result: out.output, summary: out.summary, diff: (out as any).diff ?? state.diff, endTime: Date.now() });
      if (name === 'execute_bash' && state.args.run_in_background) this.callbacks.onBackgroundChange?.(this.background.running(), this.background.list());
      let output = out.output;
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
          { value: 'no', label: 'No, keep planning (tell Fuller what to change)' },
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
      this.callbacks.onNotice({ level: 'warn', text: 'Fuller is busy — wait for the current turn to finish.' });
      return;
    }
    this.processing = true;
    this.abortController = new AbortController();
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: command, kind: 'bash', timestamp: Date.now() };
    this.messages.push(userMsg);
    this.callbacks.onCommit({ key: userMsg.id, kind: 'user', message: userMsg });
    const state: ToolCallState = { id: uid(), name: 'execute_bash', args: { command }, status: 'running', startTime: Date.now() };
    this.callbacks.onLive({ text: '', tools: [state] });
    this.callbacks.onStatusChange('running_tool');
    try {
      const res = await executeBash(command, this.config.workspaceDir, { timeoutMs: this.config.bashTimeoutMs, signal: this.abortController.signal });
      const output = [res.stdout, res.stderr ? `[stderr]\n${res.stderr}` : ''].filter(Boolean).join('\n') || '(no output)';
      const finished: ToolCallState = {
        ...state,
        status: res.exitCode === 0 ? 'completed' : 'failed',
        result: truncateMiddle(output, LIMITS.bashOutput),
        error: res.exitCode === 0 ? undefined : `exit ${res.exitCode}`,
        summary: `${res.durationMs}ms`,
        endTime: Date.now(),
      };
      const assistant: ChatMessage = { id: uid(), role: 'assistant', content: '', parts: [{ type: 'tool', id: finished.id, toolCall: finished }], kind: 'bash', timestamp: Date.now() };
      this.messages.push(assistant);
      this.callbacks.onLive(null);
      this.callbacks.onCommit({ key: finished.id, kind: 'tool', messageId: assistant.id, toolCall: finished });
      this.pendingContext.push(`[The user ran this shell command themselves: \`${command}\` (exit ${res.exitCode})]\n${truncateMiddle(output, 10_000)}`);
    } catch (err: any) {
      this.addSystemMessage(`✗ ${err.message || String(err)}`, 'notice');
    } finally {
      this.callbacks.onLive(null);
      this.processing = false;
      this.abortController = null;
      this.callbacks.onStatusChange('idle');
      this.scheduleSave();
      this.processQueue();
    }
  }

  // ---------------------------------------------------------------- side chat ("/btw")
  public async sideChat(question: string): Promise<void> {
    if (this.processing) {
      this.callbacks.onNotice({ level: 'warn', text: 'Fuller is busy — wait for the current turn to finish.' });
      return;
    }
    this.processing = true;
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
      this.addSystemMessage('Nothing to compact yet.', 'notice');
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
