import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Content } from '@google/genai';

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-robust-home-'));

/** Each call to sendMessageStream takes the next scripted answer. */
let script: Array<{ text?: string; call?: boolean; finish?: string; cached?: number }> = [];
let requests = 0;
let lastConfig: any;
let lastHistory: Content[] = [];
vi.mock('@google/genai', async (importOriginal) => {
  const real: any = await importOriginal();
  class GoogleGenAI {
    chats = {
      create: ({ config, history }: any) => {
        lastConfig = config;
        lastHistory = history ?? [];
        return {
          getHistory: () => lastHistory,
          sendMessageStream: async () => {
            requests++;
            const step = script.shift() ?? { text: 'done', finish: 'STOP' };
            const parts = [...(step.text ? [{ text: step.text }] : []), ...(step.call ? [{ functionCall: { id: 'c1', name: 'read_file', args: { file_path: 'a' } } }] : [])];
            return (async function* () {
              yield { candidates: [{ content: { parts }, finishReason: step.finish }], usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: step.cached ?? 0, totalTokenCount: 1010 } };
            })();
          },
        };
      },
    };
    models = {};
  }
  return { ...real, GoogleGenAI };
});

import { GeminiAgentSession, EmptyTurnError, historyToText, sanitizeHistory } from '../src/agent/gemini.js';
import { getConfig } from '../src/config.js';
import { getSystemPrompt } from '../src/agent/systemPrompt.js';

const newSession = () => new GeminiAgentSession({ ...getConfig({ workspaceDir: process.cwd(), apiKey: 'robust-key', model: 'gemini-3.6-flash' }), apiKeys: ['robust-key'] } as any);

beforeEach(() => { script = []; requests = 0; });

describe('history repair', () => {
  const completed = (): Content[] => [
    { role: 'user', parts: [{ text: 'Fix the bug.' }] },
    { role: 'model', parts: [{ thoughtSignature: 'opaque-signature', functionCall: { id: 'read1', name: 'read_file', args: { file_path: 'a.js' } } }] },
    { role: 'user', parts: [{ functionResponse: { id: 'read1', name: 'read_file', response: { output: 'file contents' } } }] },
    { role: 'model', parts: [{ functionCall: { id: 'edit1', name: 'edit_file', args: {} } }] },
    { role: 'user', parts: [{ functionResponse: { id: 'edit1', name: 'edit_file', response: { output: 'Updated a.js' } } }] },
  ];
  const pending: Content = { role: 'model', parts: [{ thoughtSignature: 'pending-signature', functionCall: { id: 'test1', name: 'execute_bash', args: { command: 'npm test' } } }] };

  it('preserves completed exchanges and their signatures at the tail', () => {
    const history = completed();
    expect(sanitizeHistory(history)).toEqual(history);
  });

  it('drops only the unanswered tail, without mutating the original history', () => {
    const history = [...completed(), pending];
    expect(sanitizeHistory(history)).toEqual(completed());
    expect(history).toHaveLength(6);
    expect(sanitizeHistory(sanitizeHistory(history))).toEqual(completed());
  });

  it('repairs the session without deleting the previous tool chain', () => {
    const session = newSession();
    vi.spyOn(session, 'getHistory').mockReturnValue([...completed(), pending]);
    session.repairHistory();
    expect(lastHistory).toEqual(completed());
  });

  it('keeps the complete history on refresh', () => {
    const session = newSession();
    session.initChat(completed());
    session.refresh();
    expect(lastHistory).toEqual(completed());
  });

  it('drops an unmatched response without discarding an earlier completed chain', () => {
    const history: Content[] = [...completed(), pending, { role: 'user', parts: [{ functionResponse: { id: 'wrong', name: 'execute_bash', response: {} } }] }];
    expect(sanitizeHistory(history)).toEqual(completed());
  });

  it('matches parallel same-name calls one-to-one, not by name alone', () => {
    const prefix = completed();
    const call: Content = { role: 'model', parts: ['a', 'b'].map((id) => ({ functionCall: { id, name: 'read_file', args: {} } })) };
    const responses = (ids: string[]): Content => ({ role: 'user', parts: ids.map((id) => ({ functionResponse: { id, name: 'read_file', response: {} } })) });
    const history = [...prefix, call, responses(['b', 'a'])];
    expect(sanitizeHistory(history)).toEqual(history);
    expect(sanitizeHistory([...prefix, call, responses(['a', 'a'])])).toEqual(prefix);
    expect(sanitizeHistory([...prefix, call, responses(['a'])])).toEqual(prefix);
  });

  it('preserves matching calls without IDs for models that omit them', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'read' }] },
      { role: 'model', parts: [{ functionCall: { name: 'read_file', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'read_file', response: {} } }] },
    ];
    expect(sanitizeHistory(history)).toEqual(history);
  });
});

describe('Gemini integration (lot 1)', () => {
  it('sends no temperature (Google: keep Gemini 3 sampling defaults)', () => {
    newSession();
    expect(lastConfig.temperature).toBeUndefined();
  });

  it('sends an empty answer again, silently, and returns the next one', async () => {
    script = [{ finish: 'STOP' }, { text: 'hello', finish: 'STOP' }];
    const turn = await newSession().sendUserMessage('hi', {} as any);
    expect(turn.text).toBe('hello');
    expect(requests).toBe(2);
  });

  it('gives up after two malformed tool calls with a clear error', async () => {
    script = [{ finish: 'MALFORMED_FUNCTION_CALL' }, { finish: 'MALFORMED_FUNCTION_CALL' }, { finish: 'MALFORMED_FUNCTION_CALL' }];
    await expect(newSession().sendUserMessage('hi', {} as any)).rejects.toThrow(EmptyTurnError);
    expect(requests).toBe(3);
  });

  it('does not retry a refusal, and reports why the model stopped', async () => {
    script = [{ finish: 'SAFETY' }];
    const turn = await newSession().sendUserMessage('hi', {} as any);
    expect(turn).toMatchObject({ text: '', finishReason: 'SAFETY' });
    expect(requests).toBe(1);
  });

  it('counts the prompt tokens served by the cache', async () => {
    script = [{ text: 'ok', finish: 'STOP', cached: 800 }];
    const turn = await newSession().sendUserMessage('hi', {} as any);
    expect(turn.usage).toMatchObject({ promptTokens: 1000, cachedTokens: 800 });
  });

  it('puts the stable instructions first and what changes (date, branch, mode) last', () => {
    const prompt = getSystemPrompt({ workspaceDir: process.cwd(), model: 'gemini-3.6-flash', permissionMode: 'default', gitBranch: 'main' });
    const env = prompt.indexOf('# Environment');
    expect(prompt.indexOf('# How to work')).toBeLessThan(env);
    expect(prompt.indexOf('# Learned memory')).toBeLessThan(env);
    expect(prompt.slice(env)).toContain('Git branch: main');
    expect(prompt.trimEnd().endsWith('Permission mode: default')).toBe(true);
  });

  it('keeps the end of long tool outputs in the compaction text, where errors are', () => {
    const log = `${'noise line\n'.repeat(400)}FAIL test/range.test.js: expected 6, got 3`;
    const text = historyToText([{ role: 'user', parts: [{ functionResponse: { name: 'execute_bash', response: { output: log } } }] }] as any);
    expect(text).toContain('FAIL test/range.test.js: expected 6, got 3');
    expect(text).toContain('characters left out');
  });
});

describe('long command outputs', () => {
  it('say where the full output is, and read_file may read it', async () => {
    const { dispatchTool } = await import('../src/tools/registry.js');
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-robust-ws-'));
    const outputs = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-robust-out-'));
    const outputFile = path.join(outputs, 'cmd.log');
    const ctx = { cwd: ws, extraDirs: [], bashTimeoutMs: 20_000, outputFile, readableDirs: [outputs] };
    const res = await dispatchTool('execute_bash', { command: 'seq 1 20000; echo LAST-LINE' }, ctx as any);
    expect(res.output).toContain(`[Full output saved to ${outputFile}`);
    const read = await dispatchTool('read_file', { file_path: outputFile, offset: 20000, limit: 5 }, ctx as any);
    expect(read.output).toContain('LAST-LINE');
    await expect(dispatchTool('read_file', { file_path: path.join(os.tmpdir(), 'elsewhere.txt') }, ctx as any)).rejects.toThrow();
  });
});
