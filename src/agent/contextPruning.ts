import fs from 'node:fs';
import path from 'node:path';
import type { Content, FunctionCall, Part } from '@google/genai';

/**
 * Old tool outputs are cleared from the conversation sent to the model (Anthropic's
 * "clear tool uses", Gemini CLI's masking): a file read at turn 2 or a test log from turn 5
 * is sent again with every later request, for nothing. The recent rounds stay intact; older
 * long outputs are replaced by a short marker and saved on disk, so the model can read them
 * back. Calls, ids and thought signatures are untouched: only the response text changes.
 */
export const PRUNING = {
  /** The most recent tool-response rounds (one round = one batch of tool results) are never touched. */
  keepRounds: 3,
  /**
   * Working set: the most recent long outputs stay while they weigh at most this much together
   * (about 50 000 tokens of a 1M window). Older ones beyond it are the only candidates. Two real
   * sessions (25/09) showed a 3-round working set makes the model search and read the same
   * things again and again on fan-out tasks (a file read 12 times, a query run 6 times).
   */
  budgetChars: 200_000,
  /** Shorter outputs stay: they are cheap and usually the useful part (a diff, an exit code). */
  minChars: 1_500,
  /** Nothing is cleared until this much output sits beyond the budget, so the prompt prefix (implicit cache) changes rarely. */
  triggerChars: 40_000,
  /** Kept at the top of the marker, so the model remembers what it was. */
  headChars: 160,
} as const;

export interface PruneOptions {
  /** Where cleared outputs are written (`ctx-<round>-<part>.txt`); without it they are only described. */
  saveDir?: string;
  keepRounds?: number;
  budgetChars?: number;
  minChars?: number;
  triggerChars?: number;
  /** Clear even under the trigger (manual /compact-like use). */
  force?: boolean;
}

export interface PruneResult {
  history: Content[];
  /** Outputs cleared by this pass. */
  pruned: number;
  /** Characters removed from the conversation by this pass. */
  chars: number;
}

export const CLEARED_MARKER = '[Cleared from context';

const MAIN_ARG = ['file_path', 'command', 'query', 'pattern', 'dir_path', 'url', 'prompt', 'task_id'];

/** `read_file(src/agent/loop.ts)`: the call a response answers, found in the model turn before it. */
function describeCall(call: FunctionCall | undefined, name: string): string {
  if (!call) return name;
  const args = (call.args ?? {}) as Record<string, unknown>;
  const key = MAIN_ARG.find((k) => typeof args[k] === 'string' && (args[k] as string).trim());
  if (!key) return call.name ?? name;
  const value = String(args[key]).replace(/\s+/g, ' ').trim();
  return `${call.name ?? name}(${value.length > 80 ? `${value.slice(0, 79)}…` : value})`;
}

/**
 * The call a response answers: in the model contents just before the round. The SDK's curated
 * history can split one model turn into several contents (calls, then text), so every model
 * content back to the previous user content is searched (seen in a real session, 25/09).
 */
function findCall(history: Content[], round: number, response: { id?: string; name?: string }, used: Set<FunctionCall>): FunctionCall | undefined {
  for (let i = round - 1; i >= 0 && history[i].role === 'model'; i--) {
    const calls = (history[i].parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []));
    const call = calls.find((c) => !used.has(c) && c.name === response.name && (response.id === undefined || c.id === undefined || c.id === response.id));
    if (call) { used.add(call); return call; }
  }
  return undefined;
}

/** Tools whose call can be repeated to get the output back without side effects. */
const REREADABLE = new Set(['read_file', 'outline_file', 'search_files', 'glob', 'list_directory', 'web_fetch']);

/**
 * How the model gets a cleared output back. A command (or any tool with effects) is only
 * cleared when its output is archived: "run it again" must never point at a deploy or a test
 * that changed something (Codex, C001). Without an archive, the output stays in the context.
 */
function hint(call: FunctionCall | undefined, saved?: string): string | null {
  const name = call?.name ?? '';
  if (saved) return `Full output saved at ${saved} — read it with read_file (offset/limit) if you need it.`;
  if (name === 'read_file' || name === 'outline_file') return 'Read the file again if you need it (you will see its current content, which may have changed since).';
  if (REREADABLE.has(name)) return 'Run the same call again if you need it.';
  return null;
}

/**
 * The history with old long tool outputs replaced by markers. The input is not modified.
 * The most recent long outputs are kept as a working set (`keepRounds` at least, and as many
 * older ones as fit in `budgetChars`); beyond it, nothing changes until the excess weighs
 * `triggerChars`, then every output beyond the budget goes at once: one prefix change
 * instead of one per request.
 */
export function pruneToolOutputs(history: Content[], options: PruneOptions = {}): PruneResult {
  const keepRounds = options.keepRounds ?? PRUNING.keepRounds;
  const budgetChars = options.budgetChars ?? PRUNING.budgetChars;
  const minChars = options.minChars ?? PRUNING.minChars;
  const triggerChars = options.triggerChars ?? PRUNING.triggerChars;
  const rounds = history.map((c, i) => (c.role === 'user' && (c.parts ?? []).some((p) => p.functionResponse) ? i : -1)).filter((i) => i >= 0);
  const clearable = rounds.slice(0, Math.max(0, rounds.length - keepRounds));
  type Candidate = { round: number; part: number; output: string };
  const older: Candidate[] = [];
  for (const round of clearable) {
    (history[round].parts ?? []).forEach((p, part) => {
      const output = (p.functionResponse?.response as { output?: unknown } | undefined)?.output;
      if (typeof output !== 'string' || output.length < minChars || output.startsWith(CLEARED_MARKER)) return;
      older.push({ round, part, output });
    });
  }
  // Newest first: what fits in the budget stays, the rest (oldest) is the candidate list.
  let kept = 0;
  let firstBeyond = older.length;
  for (let i = older.length - 1; i >= 0; i--) {
    if (kept + older[i].output.length > budgetChars) { firstBeyond = i + 1; break; }
    kept += older[i].output.length;
    firstBeyond = i;
  }
  const candidates = older.slice(0, firstBeyond);
  const chars = candidates.reduce((n, c) => n + c.output.length, 0);
  if (candidates.length === 0 || (!options.force && chars < triggerChars)) return { history, pruned: 0, chars: 0 };

  const next = history.map((c) => ({ ...c, parts: c.parts ? [...c.parts] : c.parts }));
  const usedCalls = new Set<FunctionCall>();
  let removed = 0;
  let unarchived = 0;
  if (options.saveDir) {
    try { fs.mkdirSync(options.saveDir, { recursive: true, mode: 0o700 }); } catch {}
  }
  for (const { round, part, output } of candidates) {
    const original = next[round].parts![part];
    const response = original.functionResponse!;
    const call = findCall(history, round, { id: response.id, name: response.name }, usedCalls);
    let saved: string | undefined;
    if (options.saveDir && call?.name !== 'read_file' && call?.name !== 'outline_file') {
      const file = path.join(options.saveDir, `ctx-${round}-${part}.txt`);
      try { fs.writeFileSync(file, output, { encoding: 'utf8', mode: 0o600 }); saved = file; } catch {}
    }
    const recovery = hint(call, saved);
    if (!recovery) { unarchived++; continue; }
    const lines = output.split('\n').length;
    const head = output.slice(0, PRUNING.headChars).split('\n')[0];
    const marker = `${CLEARED_MARKER} to save space: the output of ${describeCall(call, response.name ?? 'tool')} (${lines} line${lines === 1 ? '' : 's'}, ${output.length.toLocaleString('en-US')} characters). ${recovery}]\n${head}${output.length > head.length ? ' …' : ''}`;
    const replaced: Part = { ...original, functionResponse: { ...response, response: { ...(response.response as Record<string, unknown>), output: marker } } };
    next[round].parts![part] = replaced;
    removed += output.length - marker.length;
  }
  const pruned = candidates.length - unarchived;
  return pruned > 0 ? { history: next, pruned, chars: removed } : { history, pruned: 0, chars: 0 };
}
