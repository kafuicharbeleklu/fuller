import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Keep the key state of these sessions out of the real ~/.fuller.
process.env.HOME = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fuller-fallback-home-'));

/** Which (key, model) pairs fail, and how. */
let failing: Record<string, 'quota' | 'rpm' | 'overloaded'> = {};
const calls: string[] = [];
vi.mock('@google/genai', async (importOriginal) => {
  const real: any = await importOriginal();
  class GoogleGenAI {
    constructor(private opts: { apiKey: string }) {}
    chats = {
      create: ({ model, history }: { model: string; history?: any[] }) => ({
        getHistory: () => history ?? [],
        sendMessageStream: async () => {
          calls.push(`${this.opts.apiKey}/${model}`);
          const how = failing[`${this.opts.apiKey}/${model}`] ?? failing[`*/${model}`];
          if (how === 'quota') throw Object.assign(new Error('{"error":{"code":429,"message":"Quota exceeded for metric GenerateRequestsPerDayPerProjectPerModel","status":"RESOURCE_EXHAUSTED"}}'), { status: 429 });
          if (how === 'rpm') throw Object.assign(new Error('{"error":{"code":429,"message":"Quota exceeded for metric GenerateRequestsPerMinutePerProjectPerModel. Please retry in 5s.","status":"RESOURCE_EXHAUSTED"}}'), { status: 429 });
          if (how === 'overloaded') throw Object.assign(new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'), { status: 503 });
          const text = `${this.opts.apiKey}/${model}`;
          return (async function* () { yield { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 1000 } }; })();
        },
      }),
    };
    models = {};
  }
  return { ...real, GoogleGenAI };
});

import { GeminiAgentSession, adaptHistoryForModel, SKIP_SIGNATURE } from '../src/agent/gemini.js';
import { getConfig } from '../src/config.js';
import { supportedThinkingLevels, defaultThinkingLevel } from '../src/agent/thinking.js';
import { modelLabel } from '../src/ui/modelLabel.js';

let keySet = 0;
/** A fresh key set per test: the scheduler is shared per set of keys. */
const session = (settings: Record<string, unknown> = {}) => {
  keySet++;
  const keys = [`k${keySet}a`, `k${keySet}b`];
  const config = { ...getConfig({ workspaceDir: process.cwd(), apiKey: keys[0], model: 'gemini-3.6-flash' }), apiKeys: keys };
  config.settings = { ...config.settings, fallbackModels: ['gemini-3.5-flash', 'gemma-4-26b-a4b-it'], ...settings } as any;
  return { s: new GeminiAgentSession(config as any), keys };
};

beforeEach(() => { failing = {}; calls.length = 0; });

describe('quota scheduler in a session', () => {
  it('changes key silently for the same model, then keeps the model', async () => {
    const { s, keys } = session();
    const changed = vi.fn();
    s.onModelChange = changed;
    failing[`${keys[0]}/gemini-3.6-flash`] = 'quota';
    expect((await s.sendUserMessage('hi', {} as any)).text).toBe(`${keys[1]}/gemini-3.6-flash`);
    expect(changed).not.toHaveBeenCalled();
  });

  it('moves to the next model only when every key is out of quota for this one, and comes back', async () => {
    const { s, keys } = session();
    const changed = vi.fn();
    s.onModelChange = changed;
    failing['*/gemini-3.6-flash'] = 'quota';
    expect((await s.sendUserMessage('hi', {} as any)).text).toBe(`${keys[1]}/gemini-3.5-flash`);
    expect(changed).toHaveBeenCalledWith('gemini-3.6-flash', 'gemini-3.5-flash', 'quota');
    expect(s.preferred).toBe('gemini-3.6-flash');
  });

  it('comes back to the preferred model at the next message once its quota is back', async () => {
    const { s } = session();
    const changed = vi.fn();
    s.onModelChange = changed;
    failing['*/gemini-3.6-flash'] = 'rpm';
    expect((await s.sendUserMessage('hi', {} as any)).text).toMatch(/gemini-3\.5-flash$/);
    failing = {};
    vi.setSystemTime(Date.now() + 10_000);
    try {
      expect((await s.sendUserMessage('again', {} as any)).text).toMatch(/gemini-3\.6-flash$/);
      expect(changed).toHaveBeenLastCalledWith('gemini-3.5-flash', 'gemini-3.6-flash', 'back');
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves on after 3 overloaded answers', async () => {
    const { s } = session();
    const changed = vi.fn();
    s.onModelChange = changed;
    failing['*/gemini-3.6-flash'] = 'overloaded';
    expect((await s.sendUserMessage('hi', {} as any)).text).toMatch(/gemini-3\.5-flash$/);
    expect(changed).toHaveBeenCalledWith('gemini-3.6-flash', 'gemini-3.5-flash', 'overloaded');
  }, 30_000);

  it('stays on one model when the fallback is off', () => {
    const { s } = session({ fallbackModels: 'off' });
    const quota = Object.assign(new Error('Quota exceeded'), { status: 429 });
    const recover = (s as any).makeRecover();
    expect(recover(quota)).toBe(true); // second key
    expect(recover(quota)).toBe(false); // no other key, no other model
    expect(s.model).toBe('gemini-3.6-flash');
  });
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
    const back = adaptHistoryForModel(adaptHistoryForModel(history, 'gemma-4-26b-a4b-it'), 'gemini-3.6-flash');
    expect(back[1].parts[0].thoughtSignature).toBe(SKIP_SIGNATURE);
  });

  it('knows Gemma thinking levels and names', () => {
    expect(supportedThinkingLevels('gemma-4-26b-a4b-it')).toEqual(['minimal', 'high']);
    expect(defaultThinkingLevel('gemma-4-31b-it')).toBe('high');
    expect(modelLabel('gemma-4-26b-a4b-it')).toBe('Gemma 4 26B A4B');
  });
});
