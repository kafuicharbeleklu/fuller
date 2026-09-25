import { GeminiAgentSession, type ToolResponsePayload, type TurnUsage } from './gemini.js';
import { dispatchTool, toolLabel, toolArgSummary, geminiToolDeclarations } from '../tools/registry.js';
import type { RunInTerminal } from '../tools/nativeTerminal.js';
import { evaluatePermission, type Evaluation } from '../permissions/rules.js';
import type { AppConfig } from '../config.js';
import type { SubagentDefinition } from './subagents.js';
import type { SkillDefinition } from '../skills/loader.js';
import type { ToolCallState, PermissionDecision } from './types.js';
import type { CheckpointManager } from '../checkpoint/manager.js';
import type { BackgroundTaskManager } from '../tools/background.js';
import { uid } from './transcript.js';
import { FileTracker } from '../tools/fileTracker.js';
import type { Content } from '@google/genai';

export interface SubagentRunParams {
  runInTerminal?: RunInTerminal;
  config: AppConfig;
  definition: SubagentDefinition;
  prompt: string;
  description: string;
  signal: AbortSignal;
  skills: SkillDefinition[];
  askPermission: (state: ToolCallState, evaluation: Evaluation) => Promise<PermissionDecision>;
  onProgress: (line: string, toolCount: number) => void;
  onUsage?: (usage: TurnUsage) => void;
  checkpointManager?: CheckpointManager;
  background?: BackgroundTaskManager;
  messageId?: string;
  /** Parent conversation to start from: a fork (/btw f) inherits it. */
  history?: Content[];
}

export interface SubagentResult {
  text: string;
  /** False for a stopped/truncated/refused turn, even when it contains text. */
  completed: boolean;
  toolCount: number;
  turns: number;
  tokens: number;
}

/** Tools a subagent can never use (no recursion, no plan/todo state or memory of the parent). */
const NEVER = new Set(['agent', 'exit_plan_mode', 'todo_write', 'memory']);

/**
 * Run a delegated task in an isolated model session. Tool calls go through the
 * parent's permission system (mode, rules, prompts) so nothing bypasses the user.
 */
export async function runSubagent(params: SubagentRunParams): Promise<SubagentResult> {
  const { config, definition, signal } = params;
  const allowed = new Set(
    (definition.tools.length ? definition.tools : geminiToolDeclarations.map((d) => d.name!)).filter((t) => !NEVER.has(t))
  );
  const subConfig: AppConfig = { ...config, model: definition.model ?? config.model, settings: config.settings };
  const session = new GeminiAgentSession(subConfig, params.history);
  session.setSkills(params.skills);
  session.setToolFilter([...allowed]);
  session.setExtraInstructions(
    `# Subagent: ${definition.name}\nYou are running as a subagent for the task: "${params.description}".\n${definition.prompt}\n\nWhen done, answer with a self-contained final report; it is the only thing the caller will see.`
  );
  session.refresh();

  // A subagent reads what it edits, like the main agent.
  const fileTracker = new FileTracker();
  let toolCount = 0;
  let turns = 0;
  let tokens = 0;
  const log: string[] = [];
  const progress = (line: string) => {
    log.push(line);
    if (log.length > 6) log.shift();
    params.onProgress(log.join('\n'), toolCount);
  };

  let turn = await session.sendUserMessage(params.prompt, { signal });
  let finalText = turn.text;
  for (;;) {
    if (turn.usage) { tokens += turn.usage.totalTokens; params.onUsage?.(turn.usage); }
    // The caller needs the final turn, never a stale pre-tool claim of success.
    finalText = turn.text;
    if (turn.functionCalls.length === 0) break;
    turns++;
    if (turns > definition.maxTurns) {
      finalText = `${finalText}\n\n[Subagent stopped: max turns (${definition.maxTurns}) reached]`;
      break;
    }
    const responses: ToolResponsePayload[] = [];
    for (const call of turn.functionCalls) {
      if (signal.aborted) throw new Error('Interrupted');
      const state: ToolCallState = { id: call.id || uid(), name: call.name, args: call.args, status: 'pending', startTime: Date.now() };
      const label = `${toolLabel(call.name)}(${toolArgSummary(call.name, call.args)})`;
      if (!allowed.has(call.name)) {
        responses.push({ id: call.id, name: call.name, output: `Error: the ${definition.name} subagent may not use ${call.name}.` });
        progress(`✗ ${label} — not allowed`);
        continue;
      }
      const evaluation = evaluatePermission(call.name, call.args, config.workspaceDir, config.permissionMode, config.settings, config.additionalDirectories);
      if (evaluation.decision === 'deny') {
        responses.push({ id: call.id, name: call.name, output: `Error: denied (${evaluation.reason}).` });
        progress(`✗ ${label} — denied`);
        continue;
      }
      let approvalComment: string | undefined;
      if (evaluation.decision === 'ask') {
        progress(`? ${label} — waiting for permission`);
        const decision = await params.askPermission(state, evaluation);
        if (decision.kind === 'yes') approvalComment = decision.feedback;
        // "During this session": the parent shares this list, so the directory stays open for it too.
        const addDirectory = decision.kind === 'always' ? evaluation.options.find((o) => o.value === 'always')?.addDirectory : undefined;
        if (addDirectory && !config.additionalDirectories.includes(addDirectory)) config.additionalDirectories.push(addDirectory);
        if (decision.kind === 'no') {
          responses.push({ id: call.id, name: call.name, output: `Error: the user declined this tool call.${decision.feedback ? ` They said: "${decision.feedback}".` : ''}` });
          progress(`✗ ${label} — rejected by user`);
          continue;
        }
      }
      try {
        const out = await dispatchTool(call.name, call.args, {
          runInTerminal: params.runInTerminal,
          cwd: config.workspaceDir,
          extraDirs: evaluation.outsideDir ? [...config.additionalDirectories, evaluation.outsideDir] : config.additionalDirectories,
          checkpointManager: params.checkpointManager,
          signal,
          bashTimeoutMs: config.bashTimeoutMs,
          messageId: params.messageId,
          skills: params.skills,
          background: params.background,
          fileTracker,
        });
        toolCount++;
        responses.push({ id: call.id, name: call.name, output: out.output + (approvalComment ? `\n\n[User comment on this approval]\n${approvalComment}` : '') });
        progress(`⏺ ${label}${out.summary ? ` · ${out.summary}` : ''}`);
      } catch (err: any) {
        if (err?.message === 'Interrupted' || signal.aborted) throw new Error('Interrupted');
        toolCount++;
        responses.push({ id: call.id, name: call.name, output: `Error: ${err?.message ?? err}` });
        progress(`✗ ${label} — ${String(err?.message ?? err).split('\n')[0]}`);
      }
    }
    turn = await session.sendToolResponses(responses, { signal });
  }
  const completed = turn.functionCalls.length === 0 && (!turn.finishReason || turn.finishReason === 'STOP');
  return { text: finalText.trim() || '(the subagent returned no text)', completed, toolCount, turns, tokens };
}
