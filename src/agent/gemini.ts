import { GoogleGenAI, ThinkingLevel, type Content, type FunctionDeclaration, type GenerateContentConfig, type Part } from '@google/genai';
import { getSystemPrompt } from './systemPrompt.js';
import { geminiToolDeclarations } from '../tools/registry.js';
import { keyPoolFor, isKeyError, isDeadKeyError, isQuotaError, type KeyPool } from './keyPool.js';
import { errorStatus } from './retry.js';
import { withRetry, type RetryInfo } from './retry.js';
import type { AppConfig } from '../config.js';
import type { SkillDefinition } from '../skills/loader.js';
import type { SubagentDefinition } from './subagents.js';
import { effectiveThinkingLevel, supportedThinkingLevels, type ThinkingLevelSetting } from './thinking.js';

export interface FunctionCallInfo {
  id?: string;
  name: string;
  args: Record<string, any>;
}

export interface TurnUsage {
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  thoughtsTokens: number;
}

export interface ModelTurnOutput {
  text: string;
  functionCalls: FunctionCallInfo[];
  usage?: TurnUsage;
}

export interface ToolResponsePayload {
  id?: string;
  name: string;
  output: string;
}

export interface StreamOptions {
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
  onRetry?: (info: RetryInfo) => void;
  onAttempt?: () => void;
  gitBranch?: string;
}

export class GeminiAgentSession {
  private ai: GoogleGenAI;
  private chat: any;
  private chatConfig: GenerateContentConfig = {};
  private config: AppConfig;
  private gitBranch?: string;
  private skills: SkillDefinition[] = [];
  private extraTools: FunctionDeclaration[] = [];
  private toolFilter: Set<string> | null = null;
  private extraInstructions = '';
  private subagents: SubagentDefinition[] = [];

  /** Called when calls move to another API key after a quota or access error (position is 1-based). */
  public onKeySwitch?: (position: number, total: number, reason: 'quota' | 'unusable') => void;
  private readonly keys: KeyPool;
  private keyInUse: string;

  constructor(config: AppConfig, history?: Content[]) {
    this.config = config;
    this.keys = keyPoolFor(config.apiKeys?.length ? config.apiKeys : [config.apiKey]);
    this.keyInUse = this.keys.current();
    this.ai = new GoogleGenAI({ apiKey: this.keyInUse });
    this.initChat(history);
  }

  /** Which key is in use, as "2/3" (keys themselves are never shown). */
  public get keyStatus(): { position: number; total: number } {
    return { position: this.keys.position, total: this.keys.size };
  }

  /** Follow the pool when another session (a subagent, a side call) already moved to another key. */
  private syncKey(): void {
    const key = this.keys.current();
    if (key === this.keyInUse) return;
    const history = this.getHistory();
    this.keyInUse = key;
    this.ai = new GoogleGenAI({ apiKey: key });
    this.initChat(history);
  }

  /**
   * withRetry's recover hook for one request: a quota error or an unusable key moves the
   * conversation to the next key; when no key is left for this model, or the model stays
   * overloaded (503) for OVERLOAD_RETRIES attempts, it moves to the fallback model.
   */
  private makeRecover(): (err: any) => boolean {
    let overloaded = 0;
    return (err: any): boolean => {
      if (isKeyError(err)) {
        if (this.keys.current() !== this.keyInUse) { this.syncKey(); return true; }
        if (this.keys.rotate(err)) {
          this.syncKey();
          this.onKeySwitch?.(this.keys.position, this.keys.size, isDeadKeyError(err) ? 'unusable' : 'quota');
          return true;
        }
        return isQuotaError(err) && this.fallBack('quota');
      }
      if (isOverloadError(err) && ++overloaded >= OVERLOAD_RETRIES) return this.fallBack('overloaded');
      return false;
    };
  }


  public get model(): string {
    return this.config.model;
  }

  public setGitBranch(branch?: string) {
    this.gitBranch = branch;
  }

  public setSkills(skills: SkillDefinition[]) {
    this.skills = skills;
  }

  /** Dynamic tools (MCP servers) added to the built-in declarations. */
  public setExtraTools(tools: FunctionDeclaration[]) {
    this.extraTools = tools;
  }

  /** Restrict the built-in tools offered to the model (subagents). */
  public setToolFilter(names: string[] | null) {
    this.toolFilter = names ? new Set(names) : null;
  }

  public setExtraInstructions(text: string) {
    this.extraInstructions = text;
  }

  public setSubagents(defs: SubagentDefinition[]) {
    this.subagents = defs;
  }

  public initChat(history?: Content[]) {
    const thinkingLevel = effectiveThinkingLevel(this.config.model, this.config.thinkingLevel);
    this.chatConfig = {
      systemInstruction: getSystemPrompt({
        workspaceDir: this.config.workspaceDir,
        model: this.config.model,
        permissionMode: this.config.permissionMode,
        gitBranch: this.gitBranch,
        additionalDirectories: this.config.additionalDirectories,
        skills: this.skills,
        subagents: this.toolFilter ? [] : this.subagents,
        extraInstructions: this.extraInstructions || undefined,
        // Subagents (tool filter) neither see nor write the learned memory.
        autoMemory: !this.toolFilter && this.config.settings.autoMemory !== false,
      }),
      tools: [{ functionDeclarations: [...geminiToolDeclarations.filter((d) => (!this.toolFilter || this.toolFilter.has(d.name!)) && (d.name !== 'memory' || this.config.settings.autoMemory !== false)), ...(this.toolFilter ? [] : this.extraTools)] }],
      temperature: 0.2,
      ...(thinkingLevel
        ? { thinkingConfig: { thinkingLevel: ThinkingLevel[thinkingLevel.toUpperCase() as keyof typeof ThinkingLevel] } }
        : {}),
    };
    this.chat = this.ai.chats.create({
      model: this.config.model,
      config: this.chatConfig,
      history: history && history.length > 0 ? sanitizeHistory(history) : undefined,
    });
  }

  /** Rebuild the chat (new system prompt / mode) while keeping the history. */
  public refresh() {
    this.initChat(this.getHistory());
  }

  public getHistory(): Content[] {
    try {
      return (this.chat.getHistory(true) as Content[]) ?? [];
    } catch {
      return [];
    }
  }

  public switchModel(model: string, thinkingLevel: ThinkingLevelSetting | undefined = this.config.thinkingLevel) {
    this.config.model = model;
    this.config.thinkingLevel = thinkingLevel;
    this.initChat(adaptHistoryForModel(this.getHistory(), model));
  }

  /** Called when calls move to the fallback model because the current one is overloaded or out of quota. */
  public onModelFallback?: (from: string, to: string, reason: 'overloaded' | 'quota') => void;

  /** The fallback model, unless off or already in use. */
  private fallbackTarget(): string | undefined {
    const target = this.config.settings.fallbackModel ?? DEFAULT_FALLBACK_MODEL;
    if (!target || target === 'off' || target === this.config.model) return undefined;
    return target;
  }

  /** Move the conversation to the fallback model (history adapted to it). */
  private fallBack(reason: 'overloaded' | 'quota'): boolean {
    const target = this.fallbackTarget();
    if (!target) return false;
    const from = this.config.model;
    // The fallback has its own thinking levels: keep none rather than one it may refuse.
    this.switchModel(target, undefined);
    this.onModelFallback?.(from, target, reason);
    return true;
  }

  public setThinkingLevel(level?: ThinkingLevelSetting) {
    this.config.thinkingLevel = level;
    this.refresh();
  }

  /** Replace the whole history by a summary (compaction). */
  public resetWithSummary(summary: string, tail: Content[] = []) {
    const history: Content[] = [
      { role: 'user', parts: [{ text: `[Conversation summary — the previous conversation was compacted]\n\n${summary}` }] },
      { role: 'model', parts: [{ text: 'Understood. I will continue from this summary.' }] },
      ...sanitizeHistory(tail),
    ];
    this.initChat(history);
  }

  /** Drop trailing model function calls that never received a response (after an interruption). */
  public repairHistory() {
    const history = this.getHistory();
    while (history.length > 0) {
      const last = history[history.length - 1];
      if (last.role === 'model' && last.parts?.some((p) => p.functionCall)) {
        history.pop();
        continue;
      }
      if (last.role === 'user' && last.parts?.every((p) => p.functionResponse)) {
        history.pop();
        continue;
      }
      break;
    }
    this.initChat(history);
  }

  public sendUserMessage(userInput: string | Part[], options: StreamOptions = {}): Promise<ModelTurnOutput> {
    return this.streamTurn(userInput, options);
  }

  public sendToolResponses(responses: ToolResponsePayload[], options: StreamOptions = {}): Promise<ModelTurnOutput> {
    const parts: Part[] = responses.map((r) => ({
      functionResponse: {
        ...(r.id ? { id: r.id } : {}),
        name: r.name,
        response: { output: r.output },
      },
    }));
    return this.streamTurn(parts, options);
  }

  private async streamTurn(message: string | Part[], options: StreamOptions): Promise<ModelTurnOutput> {
    const { onChunk, signal } = options;
    if (signal?.aborted) throw new Error('Interrupted');
    this.syncKey();
    let delivered = false;

    return withRetry(
      async () => {
        const stream = await this.chat.sendMessageStream({
          message,
          config: { ...this.chatConfig, abortSignal: signal },
        });
        let text = '';
        let usage: TurnUsage | undefined;
        const functionCalls: FunctionCallInfo[] = [];
        for await (const chunk of stream) {
          if (signal?.aborted) throw new Error('Interrupted');
          const parts: Part[] = chunk.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (part.text && !part.thought) {
              text += part.text;
              delivered = true;
              onChunk?.(part.text);
            }
            if (part.functionCall) {
              functionCalls.push({
                id: part.functionCall.id,
                name: part.functionCall.name || '',
                args: (part.functionCall.args as Record<string, any>) || {},
              });
            }
          }
          const u = chunk.usageMetadata;
          if (u) {
            usage = {
              promptTokens: u.promptTokenCount ?? usage?.promptTokens ?? 0,
              responseTokens: u.candidatesTokenCount ?? usage?.responseTokens ?? 0,
              totalTokens: u.totalTokenCount ?? usage?.totalTokens ?? 0,
              thoughtsTokens: u.thoughtsTokenCount ?? usage?.thoughtsTokens ?? 0,
            };
          }
        }
        return { text, functionCalls, usage };
      },
      {
        signal,
        // A partly streamed answer is not resent on another key (the text would repeat).
        recover: ((recover) => (err: any) => !delivered && recover(err))(this.makeRecover()),
        onAttempt: options.onAttempt,
        onRetry: (info) => {
          if (delivered) throw info.error;
          options.onRetry?.(info);
        },
      }
    );
  }

  public async compactHistory(historyText: string, focus?: string, signal?: AbortSignal): Promise<string> {
    const prompt = `You are compacting a coding-agent conversation so that work can continue seamlessly with a smaller context.
Write a dense summary (Markdown, max ~600 words) with these sections:
1. Task and user intent (what the user asked, constraints, preferences).
2. Current state: what has been done, what is in progress, what remains.
3. Files touched (paths) and the important code/decisions in them.
4. Commands run and their outcomes (tests, builds, errors still open).
5. Anything the user asked to remember.${focus ? `\n\nPay special attention to: ${focus}` : ''}

Conversation:
${historyText}`;
    const res = await withRetry(
      () => this.ai.models.generateContent({ model: this.config.model, contents: prompt, config: { abortSignal: signal, temperature: 0.1 } }),
      { signal, recover: this.makeRecover() }
    );
    return res.text || 'Context compacted.';
  }

  /** A question answered once, outside the conversation; `withHistory` gives it the session's context (/btw). */
  public async oneShot(question: string, onChunk?: (t: string) => void, signal?: AbortSignal, withHistory = false, lowThinking = false): Promise<string> {
    this.syncKey();
    const contents = withHistory ? [...sanitizeHistory(this.getHistory()), { role: 'user', parts: [{ text: question }] }] : question;
    // Quick decisions (the auto mode classifier) use the model's lightest thinking level.
    const lowest = lowThinking ? supportedThinkingLevels(this.config.model)[0] : undefined;
    const thinking = lowest ? { thinkingConfig: { thinkingLevel: ThinkingLevel[lowest.toUpperCase() as keyof typeof ThinkingLevel] } } : {};
    const stream = await withRetry(
      () => this.ai.models.generateContentStream({ model: this.config.model, contents, config: { abortSignal: signal, ...thinking } }),
      { signal, recover: this.makeRecover() }
    );
    let full = '';
    for await (const chunk of stream) {
      if (signal?.aborted) throw new Error('Interrupted');
      const parts: Part[] = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const p of parts) {
        if (p.text && !p.thought) {
          full += p.text;
          onChunk?.(p.text);
        }
      }
    }
    return full;
  }
}

/** Gemma 4 (26B A4B): fast, calls tools well, served by the same API — the default fallback. */
export const DEFAULT_FALLBACK_MODEL = 'gemma-4-26b-a4b-it';
/** Overloaded (503) attempts on one request before moving to the fallback model. */
const OVERLOAD_RETRIES = 3;

function isOverloadError(err: any): boolean {
  const status = errorStatus(err);
  return status === 503 || /UNAVAILABLE|high demand|overloaded/i.test(String(err?.message ?? err ?? ''));
}

/** Google's documented placeholder for function calls that carry no thought signature. */
export const SKIP_SIGNATURE = 'skip_thought_signature_validator';

/**
 * A history made with one model family, made acceptable to another (checked live on 24/09/2026):
 * Gemma refuses Gemini's thought signatures and thought parts (400), and Gemini 3 wants a
 * signature on the function calls of the current turn, which Gemma never writes.
 */
export function adaptHistoryForModel(history: Content[], model: string): Content[] {
  if (/^gemma-/.test(model)) {
    return history
      .map((c) => ({ ...c, parts: (c.parts ?? []).filter((p) => !p.thought).map(({ thoughtSignature: _dropped, ...rest }) => rest as Part) }))
      .filter((c) => c.parts.length > 0);
  }
  if (/^gemini-3/.test(model)) {
    return history.map((c) => {
      if (c.role !== 'model') return c;
      const parts = c.parts ?? [];
      const first = parts.findIndex((p) => p.functionCall);
      if (first < 0 || parts.some((p) => p.thoughtSignature)) return c;
      return { ...c, parts: parts.map((p, i) => (i === first ? { ...p, thoughtSignature: SKIP_SIGNATURE } : p)) };
    });
  }
  return history;
}

/** Make sure a stored history is acceptable for chats.create (starts with a user turn, no dangling calls). */
export function sanitizeHistory(history: Content[]): Content[] {
  const cleaned = history.filter((c) => c && (c.role === 'user' || c.role === 'model') && Array.isArray(c.parts) && c.parts.length > 0);
  while (cleaned.length && cleaned[0].role !== 'user') cleaned.shift();
  while (cleaned.length) {
    const last = cleaned[cleaned.length - 1];
    if (last.role === 'model' && last.parts?.some((p) => p.functionCall)) { cleaned.pop(); continue; }
    if (last.role === 'user' && last.parts?.every((p) => p.functionResponse)) { cleaned.pop(); continue; }
    break;
  }
  return cleaned;
}

export function historyToText(history: Content[]): string {
  return history
    .map((c) => {
      const role = c.role === 'user' ? 'USER' : 'ASSISTANT';
      const body = (c.parts ?? [])
        .map((p) => {
          if (p.text) return p.text;
          if (p.functionCall) return `[tool call ${p.functionCall.name}(${JSON.stringify(p.functionCall.args ?? {}).slice(0, 400)})]`;
          if (p.functionResponse) {
            const out = String((p.functionResponse.response as any)?.output ?? '');
            return `[tool result ${p.functionResponse.name}: ${out.slice(0, 600)}${out.length > 600 ? '…' : ''}]`;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
      return `${role}:\n${body}`;
    })
    .join('\n\n');
}
