import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Keep the key state of these sessions out of the real ~/.fuller.
process.env.HOME = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fuller-fallback-home-'));

let failure: 'overloaded' | 'quota' = 'overloaded';
const created: Array<{ model: string; history: any[] }> = [];
vi.mock('@google/genai', async (importOriginal) => {
  const real: any = await importOriginal();
  class GoogleGenAI {
    chats = {
      create: ({ model, history }: { model: string; history?: any[] }) => {
        created.push({ model, history: history ?? [] });
        return {
          getHistory: () => history ?? [],
          sendMessageStream: async () => {
            if (model.startsWith('gemini')) {
              throw failure === 'overloaded'
                ? Object.assign(new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'), { status: 503 })
                : Object.assign(new Error('{"error":{"code":429,"message":"Quota exceeded for metric GenerateRequestsPerDayPerProjectPerModel","status":"RESOURCE_EXHAUSTED"}}'), { status: 429 });
            }
            return (async function* () { yield { candidates: [{ content: { parts: [{ text: `hello from ${model}` }] } }] }; })();
          },
        };
      },
    };
    models = {};
  }
  return { ...real, GoogleGenAI };
});

import { GeminiAgentSession, adaptHistoryForModel, SKIP_SIGNATURE } from '../src/agent/gemini.js';
import { getConfig } from '../src/config.js';
import { supportedThinkingLevels, defaultThinkingLevel } from '../src/agent/thinking.js';
import { modelLabel } from '../src/ui/modelLabel.js';

const session = (model = 'gemini-3.6-flash') => {
  const config = { ...getConfig({ workspaceDir: process.cwd(), apiKey: 'only-key', model }), apiKeys: ['only-key'] };
  config.settings = { ...config.settings, fallbackModel: undefined };
  return new GeminiAgentSession(config as any);
};

describe('fallback model (Claude Code --fallback-model)', () => {
  it('moves to Gemma 4 26B when Gemini stays overloaded', async () => {
    failure = 'overloaded';
    const s = session();
    const onFallback = vi.fn();
    s.onModelFallback = onFallback;
    const turn = await s.sendUserMessage('hi', {} as any);
    expect(turn.text).toBe('hello from gemma-4-26b-a4b-it');
    expect(onFallback).toHaveBeenCalledWith('gemini-3.6-flash', 'gemma-4-26b-a4b-it', 'overloaded');
    expect(s.model).toBe('gemma-4-26b-a4b-it');
  }, 30_000);

  it('moves to the fallback when the only key is out of quota, and not when it is off', async () => {
    failure = 'quota';
    const s = session();
    const onFallback = vi.fn();
    s.onModelFallback = onFallback;
    expect((await s.sendUserMessage('hi', {} as any)).text).toBe('hello from gemma-4-26b-a4b-it');
    expect(onFallback).toHaveBeenCalledWith('gemini-3.6-flash', 'gemma-4-26b-a4b-it', 'quota');

    const off = session();
    (off as any).config.settings.fallbackModel = 'off';
    const quota = Object.assign(new Error('Quota exceeded for metric GenerateRequestsPerDayPerProjectPerModel'), { status: 429 });
    expect((off as any).makeRecover()(quota)).toBe(false);
    expect(off.model).toBe('gemini-3.6-flash');
  }, 30_000);
});

describe('history across model families (checked live 24/09/2026)', () => {
  const history: any[] = [
    { role: 'user', parts: [{ text: 'Read package.json' }] },
    { role: 'model', parts: [{ text: 'thinking…', thought: true }, { functionCall: { id: 'c1', name: 'read_file', args: {} }, thoughtSignature: 'gemini-sig' }] },
    { role: 'user', parts: [{ functionResponse: { id: 'c1', name: 'read_file', response: { output: '{}' } } }] },
  ];

  it('drops Gemini thought parts and signatures for Gemma', () => {
    const adapted = adaptHistoryForModel(history, 'gemma-4-26b-a4b-it');
    expect(JSON.stringify(adapted)).not.toContain('thoughtSignature');
    expect(adapted[1].parts).toEqual([{ functionCall: { id: 'c1', name: 'read_file', args: {} } }]);
  });

  it('gives Gemma-made function calls the placeholder signature Gemini 3 accepts', () => {
    const fromGemma = adaptHistoryForModel(history, 'gemma-4-26b-a4b-it');
    const back = adaptHistoryForModel(fromGemma, 'gemini-3.6-flash');
    expect(back[1].parts[0].thoughtSignature).toBe(SKIP_SIGNATURE);
    expect(adaptHistoryForModel(history, 'gemini-3.6-flash')[1].parts[1].thoughtSignature).toBe('gemini-sig');
  });

  it('knows Gemma thinking levels and names', () => {
    expect(supportedThinkingLevels('gemma-4-26b-a4b-it')).toEqual(['minimal', 'high']);
    expect(defaultThinkingLevel('gemma-4-31b-it')).toBe('high');
    expect(modelLabel('gemma-4-26b-a4b-it')).toBe('Gemma 4 26B A4B');
    expect(modelLabel('gemma-4-31b-it')).toBe('Gemma 4 31B');
  });
});
