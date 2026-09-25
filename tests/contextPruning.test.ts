import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Content } from '@google/genai';
import { pruneToolOutputs, CLEARED_MARKER, PRUNING } from '../src/agent/contextPruning.js';
import { GeminiAgentSession } from '../src/agent/gemini.js';
import { getConfig } from '../src/config.js';

const big = (tag: string, lines = 200) => Array.from({ length: lines }, (_, i) => `${tag} line ${i + 1}`).join('\n');

/** One user prompt, then `rounds` tool rounds (call + response), then a final answer. */
function conversation(rounds: Array<{ name: string; args: Record<string, unknown>; output: string; id?: string }>): Content[] {
  const history: Content[] = [{ role: 'user', parts: [{ text: 'Do the thing' }] }];
  for (const r of rounds) {
    history.push({ role: 'model', parts: [{ functionCall: { id: r.id, name: r.name, args: r.args }, thoughtSignature: 'sig-' + r.name }] });
    history.push({ role: 'user', parts: [{ functionResponse: { id: r.id, name: r.name, response: { output: r.output } } }] });
  }
  history.push({ role: 'model', parts: [{ text: 'Done.' }] });
  return history;
}

const outputOf = (c: Content, i = 0) => String((c.parts![i].functionResponse!.response as any).output);

describe('context pruning', () => {
  it('leaves the recent rounds alone and does nothing under the trigger', () => {
    const history = conversation([
      { name: 'read_file', args: { file_path: 'a.ts' }, output: big('a') },
      { name: 'read_file', args: { file_path: 'b.ts' }, output: big('b') },
    ]);
    const result = pruneToolOutputs(history, { saveDir: undefined });
    expect(result.pruned).toBe(0);
    expect(result.history).toBe(history);
  });

  it('clears old long outputs at once when they weigh enough, keeping calls, ids and signatures', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-prune-'));
    try {
      // Two old outputs of ~30k characters each: past the 40k trigger together.
      const rounds = [
        { id: 'c1', name: 'read_file', args: { file_path: 'src/agent/loop.ts' }, output: big('loop', 2000) },
        { id: 'c2', name: 'execute_bash', args: { command: 'npm test 2>&1' }, output: big('test', 2000) },
        { id: 'c3', name: 'edit_file', args: { file_path: 'x.ts' }, output: 'Updated x.ts with 1 addition and 1 removal.' },
        { id: 'c4', name: 'search_files', args: { query: 'foo' }, output: big('grep', 2000) },
        { id: 'c5', name: 'read_file', args: { file_path: 'recent.ts' }, output: big('recent', 2000) },
        { id: 'c6', name: 'read_file', args: { file_path: 'newest.ts' }, output: big('newest', 2000) },
      ];
      const history = conversation(rounds);
      const before = JSON.stringify(history);
      const result = pruneToolOutputs(history, { saveDir: dir, budgetChars: 0 });
      expect(JSON.stringify(history)).toBe(before); // the input is not modified
      // Rounds 1-3 are old (the last 3 stay): the two long ones are cleared, the short edit result stays.
      expect(result.pruned).toBe(2);
      expect(result.chars).toBeGreaterThan(20_000);
      const responses = result.history.filter((c) => c.role === 'user' && c.parts![0].functionResponse);
      expect(outputOf(responses[0])).toMatch(/^\[Cleared from context to save space: the output of read_file\(src\/agent\/loop\.ts\) \(2000 lines, [\d,]+ characters\)\. Read the file again if you need it \(you will see its current content, which may have changed since\)\.\]\nloop line 1 …$/);
      expect(outputOf(responses[1])).toContain('the output of execute_bash(npm test 2>&1)');
      expect(outputOf(responses[1])).toMatch(/Full output saved at (.+ctx-4-0\.txt)/);
      const saved = outputOf(responses[1]).match(/saved at (\S+ctx-4-0\.txt)/)![1];
      expect(fs.readFileSync(saved, 'utf8')).toBe(big('test', 2000));
      expect(outputOf(responses[2])).toBe('Updated x.ts with 1 addition and 1 removal.');
      for (const i of [3, 4, 5]) expect(outputOf(responses[i])).toBe(rounds[i].output);
      // The model turns are untouched: same calls, same signatures.
      const calls = result.history.filter((c) => c.role === 'model' && c.parts![0].functionCall);
      expect(calls.map((c) => c.parts![0].functionCall!.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
      expect(calls.every((c) => String(c.parts![0].thoughtSignature).startsWith('sig-'))).toBe(true);
      // Response ids and names survive, so the pairs still match.
      expect(responses[0].parts![0].functionResponse!.id).toBe('c1');
      expect(responses[0].parts![0].functionResponse!.name).toBe('read_file');
      // A second pass finds nothing left to clear.
      expect(pruneToolOutputs(result.history, { saveDir: dir, force: true, budgetChars: 0 }).pruned).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps a command output that cannot be archived, instead of inviting to run the command again (C001)', () => {
    const history = conversation([
      { name: 'execute_bash', args: { command: 'npm run deploy' }, output: big('deploy', 2000) },
      { name: 'read_file', args: { file_path: 'a.ts' }, output: big('a', 2000) },
      { name: 'agent', args: { prompt: 'explore' }, output: big('report', 2000) },
      { name: 'glob', args: { pattern: '*' }, output: 'a' },
      { name: 'glob', args: { pattern: '*' }, output: 'a' },
      { name: 'glob', args: { pattern: '*' }, output: 'a' },
    ]);
    // No saveDir (a subagent without contextDir, or a failed archive): commands and subagent reports stay.
    const result = pruneToolOutputs(history, { budgetChars: 0 });
    expect(result.pruned).toBe(1);
    const responses = result.history.filter((c) => c.role === 'user' && c.parts![0].functionResponse);
    expect(outputOf(responses[0])).toBe(big('deploy', 2000));
    expect(outputOf(responses[1])).toContain('Read the file again if you need it (you will see its current content');
    expect(outputOf(responses[2])).toBe(big('report', 2000));
    expect(JSON.stringify(result.history)).not.toContain('Run it again');
    // With an archive, the command output goes and the marker points at the file.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-prune-'));
    try {
      const archived = pruneToolOutputs(history, { saveDir: dir, budgetChars: 0 });
      expect(archived.pruned).toBe(3);
      expect(outputOf(archived.history.filter((c) => c.role === 'user' && c.parts![0].functionResponse)[0])).toMatch(/Full output saved at .*ctx-2-0\.txt/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds the call when the SDK split the model turn into a call content and a text content (real session, 25/09)', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'go' }] },
      { role: 'model', parts: [{ functionCall: { id: 'c1', name: 'read_file', args: { file_path: 'src/session/store.ts' } }, thoughtSignature: 'sig' }] },
      { role: 'model', parts: [{ text: 'Reading the store.' }] },
      { role: 'user', parts: [{ functionResponse: { id: 'c1', name: 'read_file', response: { output: big('store') } } }] },
      ...conversation([{ name: 'glob', args: { pattern: '*' }, output: 'a' }, { name: 'glob', args: { pattern: '*' }, output: 'a' }, { name: 'glob', args: { pattern: '*' }, output: 'a' }]).slice(1),
    ];
    const result = pruneToolOutputs(history, { force: true, budgetChars: 0 });
    expect(result.pruned).toBe(1);
    expect(outputOf(result.history[3])).toContain('the output of read_file(src/session/store.ts)');
    expect(outputOf(result.history[3])).toContain('Read the file again');
  });

  it('handles parallel calls in one round and responses without ids', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'go' }] },
      { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { file_path: 'one.ts' } } }, { functionCall: { name: 'read_file', args: { file_path: 'two.ts' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { output: big('one') } } }, { functionResponse: { name: 'read_file', response: { output: big('two') } } }] },
      ...conversation([{ name: 'glob', args: { pattern: '*' }, output: 'a\nb' }, { name: 'glob', args: { pattern: '*' }, output: 'a' }, { name: 'glob', args: { pattern: '*' }, output: 'a' }]).slice(1),
    ];
    const result = pruneToolOutputs(history, { force: true, budgetChars: 0 });
    expect(result.pruned).toBe(2);
    expect(outputOf(result.history[2], 0)).toContain('read_file(one.ts)');
    expect(outputOf(result.history[2], 1)).toContain('read_file(two.ts)');
  });

  it('is exposed by the session, which rebuilds its chat with the pruned history', () => {
    const config = getConfig({ apiKey: 'prune-test', model: 'gemini-3.6-flash' });
    const history = conversation([
      { id: '1', name: 'read_file', args: { file_path: 'old.ts' }, output: big('old', 900) },
      { id: '2', name: 'read_file', args: { file_path: 'a.ts' }, output: 'short' },
      { id: '3', name: 'read_file', args: { file_path: 'b.ts' }, output: 'short' },
      { id: '4', name: 'read_file', args: { file_path: 'c.ts' }, output: 'short' },
    ]);
    const session = new GeminiAgentSession(config, history);
    expect(session.pruneHistory({ force: false })).toEqual({ pruned: 0, chars: 0 }); // under the trigger
    const result = session.pruneHistory({ force: true, budgetChars: 0 });
    expect(result.pruned).toBe(1);
    const stored = session.getHistory().filter((c) => c.role === 'user' && c.parts![0].functionResponse);
    expect(outputOf(stored[0])).toContain(CLEARED_MARKER);
    expect(outputOf(stored[1])).toBe('short');
  });

  it('keeps a working set of recent outputs within the budget and clears only the oldest beyond it (real sessions, 25/09)', () => {
    // Twelve old searches of ~28k characters each, then three short rounds: the budget (200k) keeps the most recent ones that fit.
    const tag = (i: number) => String.fromCharCode(97 + i); // a…l: equal-sized outputs
    const rounds = Array.from({ length: 12 }, (_, i) => ({ name: 'search_files', args: { query: tag(i) }, output: big(tag(i), 2000) }));
    const history = conversation([...rounds, ...Array.from({ length: 3 }, () => ({ name: 'glob', args: { pattern: '*' }, output: 'a' }))]);
    const result = pruneToolOutputs(history);
    const responses = result.history.filter((c) => c.role === 'user' && c.parts![0].functionResponse);
    const cleared = responses.map((r) => outputOf(r).startsWith(CLEARED_MARKER));
    const fit = Math.floor(PRUNING.budgetChars / big('a', 2000).length); // how many of the equal-sized outputs the budget holds
    expect(fit).toBeGreaterThan(3);
    expect(result.pruned).toBe(12 - fit);
    expect(cleared.slice(0, 12 - fit).every(Boolean)).toBe(true);
    expect(cleared.slice(12 - fit).some(Boolean)).toBe(false);
    // Under the trigger, nothing moves: one more old output beyond the budget is not worth a prefix change.
    const small = conversation([...rounds.slice(0, 7), { name: 'search_files', args: { query: 'x' }, output: big('x', 300) }, ...Array.from({ length: 3 }, () => ({ name: 'glob', args: { pattern: '*' }, output: 'a' }))]);
    expect(pruneToolOutputs(small).pruned).toBe(0);
  });

  it('never clears under the trigger unless forced, so the prompt prefix stays stable', () => {
    const history = conversation([
      { name: 'read_file', args: { file_path: 'old.ts' }, output: 'x'.repeat(PRUNING.triggerChars - 1) },
      { name: 'glob', args: { pattern: '*' }, output: 'a' },
      { name: 'glob', args: { pattern: '*' }, output: 'a' },
      { name: 'glob', args: { pattern: '*' }, output: 'a' },
    ]);
    expect(pruneToolOutputs(history, { budgetChars: 0 }).pruned).toBe(0);
    expect(pruneToolOutputs(history, { force: true, budgetChars: 0 }).pruned).toBe(1);
  });
});
