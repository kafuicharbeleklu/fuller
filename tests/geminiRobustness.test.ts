import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-robust-home-'));

/** Each call to sendMessageStream takes the next scripted answer. */
let script: Array<{ text?: string; call?: boolean; finish?: string; cached?: number }> = [];
let requests = 0;
let lastConfig: any;
vi.mock('@google/genai', async (importOriginal) => {
  const real: any = await importOriginal();
  class GoogleGenAI {
    chats = {
      create: ({ config }: any) => {
        lastConfig = config;
        return {
          getHistory: () => [],
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

import { GeminiAgentSession, EmptyTurnError, historyToText } from '../src/agent/gemini.js';
import { getConfig } from '../src/config.js';
import { getSystemPrompt } from '../src/agent/systemPrompt.js';

const newSession = () => new GeminiAgentSession({ ...getConfig({ workspaceDir: process.cwd(), apiKey: 'robust-key', model: 'gemini-3.6-flash' }), apiKeys: ['robust-key'] } as any);

beforeEach(() => { script = []; requests = 0; });

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
