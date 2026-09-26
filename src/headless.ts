import { AgentLoop, type AgentCallbacks } from './agent/loop.js';
import type { AppConfig } from './config.js';
import type { TranscriptItem } from './agent/types.js';
import { toolLabel, toolArgSummary } from './tools/registry.js';
import { expandSkill, commandPrompt } from './skills/loader.js';

export type OutputFormat = 'text' | 'json' | 'stream-json';

/** Non-interactive mode: run one prompt through the full agent loop and print the result. */
export async function runHeadless(config: AppConfig, prompt: string, format: OutputFormat): Promise<number> {
  const started = Date.now();
  const texts: string[] = [];
  const tools: TranscriptItem[] = [];
  let errored = false;
  const errors: string[] = [];
  const emit = (obj: Record<string, unknown>) => process.stdout.write(JSON.stringify(obj) + '\n');

  const callbacks: AgentCallbacks = {
    onStatusChange: () => {},
    onLive: () => {},
    onUsage: () => {},
    onQueueChange: () => {},
    onNotice: (n) => { if (!n) return; if (format !== 'stream-json') process.stderr.write(`${n.text}\n`); else emit({ type: 'notice', ...n }); },
    onCommit: (item) => {
      if (item.kind === 'text') {
        texts.push(item.content);
        if (format === 'text') process.stdout.write(item.content + '\n');
        if (format === 'stream-json') emit({ type: 'assistant', text: item.content });
      } else if (item.kind === 'tool') {
        tools.push(item);
        const t = item.toolCall;
        if (format === 'text') process.stderr.write(`⏺ ${toolLabel(t.name)}(${toolArgSummary(t.name, t.args)}) → ${t.status}${t.summary ? ` · ${t.summary}` : ''}${t.error ? ` · ${t.error.split('\n')[0]}` : ''}\n`);
        if (format === 'stream-json') emit({ type: 'tool', name: t.name, args: t.args, status: t.status, summary: t.summary, error: t.error });
      } else if (item.kind === 'system' && item.message.kind === 'notice') {
        if (item.message.content.startsWith('✗')) { errored = true; errors.push(item.message.content); }
        if (format !== 'stream-json') process.stderr.write(item.message.content + '\n');
        if (format === 'stream-json') emit({ type: 'system', text: item.message.content });
      }
    },
    onRequestConfirmation: (c) => {
      if (!c) return;
      // Plan mode without a user: print the plan and stop, instead of asking the model to revise it forever.
      if (c.plan) {
        texts.push(c.plan.text);
        if (format === 'text') process.stdout.write(c.plan.text + '\n');
        if (format === 'stream-json') emit({ type: 'plan', text: c.plan.text, file: c.plan.file });
        c.onDecide({ kind: 'no' });
        return;
      }
      c.onDecide({
        kind: 'no',
        feedback: 'Non-interactive mode: this action needs permission. Re-run with --permission-mode acceptEdits, --dangerously-skip-permissions, or add an allow rule (e.g. --allowedTools "Bash(npm test:*)").',
      });
    },
  };

  const agent = new AgentLoop(config, callbacks);
  await agent.mcpReady();
  if (format === 'stream-json') emit({ type: 'session', session_id: agent.sessionId, model: config.model });
  let turnOptions = {};
  const m = prompt.match(/^\/([\w:-]+)\s*([\s\S]*)$/);
  if (m) {
    const skill = agent.getSkills().find((sk) => sk.userInvocable && sk.name === m[1]);
    if (skill) turnOptions = { prompt: commandPrompt(skill, await expandSkill(skill, m[2], config.workspaceDir)), allow: skill.allowedTools };
  }
  await agent.handleUserInput(prompt, m ? 'command' : 'normal', turnOptions);
  await agent.flush();
  const result = texts.join('\n\n');
  const payload = {
    result,
    session_id: agent.sessionId,
    model: config.model,
    num_tool_calls: tools.length,
    usage: {
      total_tokens: agent.usage.cumulativeTokens, api_calls: agent.usage.apiCalls, turns: agent.usage.turns,
      // Prompt tokens sent, and the part served by Gemini's implicit cache.
      prompt_tokens: agent.usage.cumulativePromptTokens ?? 0, cached_tokens: agent.usage.cumulativeCachedTokens ?? 0,
      // Written by the model: answers and tool calls, and thinking.
      output_tokens: agent.usage.cumulativeResponseTokens ?? 0, thoughts_tokens: agent.usage.cumulativeThoughtsTokens ?? 0,
      // Old tool outputs cleared from the conversation (context pruning), and their weight in characters.
      pruned_outputs: agent.usage.prunedOutputs ?? 0, pruned_chars: agent.usage.prunedChars ?? 0,
    },
    duration_ms: Date.now() - started,
    is_error: errored,
    error: errors.length ? errors.join('\n') : undefined,
  };
  if (format === 'json') process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  if (format === 'stream-json') emit({ type: 'result', ...payload });
  return errored ? 1 : 0;
}
