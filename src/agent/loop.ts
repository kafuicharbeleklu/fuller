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
} from './types.js';

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
  public usage: UsageInfo;

  constructor(config: AppConfig, callbacks: AgentCallbacks, restored?: SessionData) {
    this.config = config;
    this.callbacks = callbacks;
    this.sessionId = restored?.meta.id ?? generateSessionId();
    this.createdAt = restored?.meta.createdAt ?? Date.now();
    this.messages = restored?.messages ?? [];
    this.gitBranch = restored?.meta.gitBranch;
    this.usage = {
      promptTokens: 0,
      responseTokens: 0,
      cumulativeTokens: restored?.meta.tokenCount ?? 0,
      contextWindow: config.contextWindow,
      apiCalls: 0,
      turns: 0,
    };
    this.session = new GeminiAgentSession(config, restored?.history);
    this.checkpointManager = new CheckpointManager(config.workspaceDir);
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
        title: sessionTitleFrom(this.messages),
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

  public async handleUserInput(input: string, kind: MessageKind = 'normal'): Promise<void> {
    if (this.processing) {
      this.queue.push(input);
      this.callbacks.onQueueChange([...this.queue]);
      return;
    }
    await this.runTurn(input, kind);
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
  private async runTurn(input: string, kind: MessageKind = 'normal'): Promise<void> {
    this.processing = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const started = Date.now();

    const userMsg: ChatMessage = { id: uid(), role: 'user', content: input, kind, timestamp: started };
    this.messages.push(userMsg);
    this.callbacks.onCommit({ key: userMsg.id, kind: 'user', message: userMsg });

    let enriched = resolveMentions(input, this.config.workspaceDir, this.config.additionalDirectories);
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
      this.callbacks.onStatusChange('idle');
      this.scheduleSave();
    }
    await this.maybeAutoCompact();
    this.processQueue();
  }

  private async executeCall(
    state: ToolCallState,
    messageId: string,
    signal: AbortSignal,
    update: (patch: Partial<ToolCallState>) => void
  ): Promise<string> {
    const { name, args } = state;
    const evaluation = evaluatePermission(name, args, this.config.workspaceDir, this.config.permissionMode, this.config.settings);
    const ctx = {
      cwd: this.config.workspaceDir,
      extraDirs: this.config.additionalDirectories,
      checkpointManager: this.checkpointManager,
      signal,
      bashTimeoutMs: this.config.bashTimeoutMs,
      messageId,
    };

    if (name === 'edit_file' || name === 'write_file') {
      const preview = await previewTool(name, args, ctx);
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

    if (evaluation.decision === 'ask') {
      update({ status: 'confirming' });
      this.callbacks.onStatusChange('awaiting_permission');
      this.callbacks.onNotify?.('permission');
      const decision = await this.askPermission(state, evaluation);
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
      const out = await dispatchTool(name, args, ctx);
      update({ status: 'completed', result: out.output, summary: out.summary, diff: out.diff ?? state.diff, endTime: Date.now() });
      return out.output;
    } catch (err: any) {
      if (err?.message === 'Interrupted' || signal.aborted) throw new Error('Interrupted');
      const message = err?.message || String(err);
      update({ status: 'failed', error: message, endTime: Date.now() });
      return `Error: ${message}`;
    }
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
