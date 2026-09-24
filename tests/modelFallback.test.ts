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

import { GeminiAgentSession, adaptHistoryForModel, SKIP_SIGNATURE, QuotaExhaustedError } from '../src/agent/gemini.js';
import { quotaBar, usageSummary, quotaMessage, formatDuration } from '../src/agent/quotaText.js';
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
  it('changes key silently for the same model: no question, no model change', async () => {
    const { s, keys } = session();
    const changed = vi.fn();
    const ask = vi.fn();
    s.onModelChange = changed;
    s.onFallbackRequest = ask;
    failing[`${keys[0]}/gemini-3.6-flash`] = 'quota';
    expect((await s.sendUserMessage('hi', {} as any)).text).toBe(`${keys[1]}/gemini-3.6-flash`);
    expect(changed).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks before leaving a model spent on every key (default policy), with one aggregated usage', async () => {
    const { s, keys } = session();
    const ask = vi.fn(async () => 'switch' as const);
    s.onFallbackRequest = ask;
    failing['*/gemini-3.6-flash'] = 'quota';
    expect((await s.sendUserMessage('hi', {} as any)).text).toBe(`${keys[1]}/gemini-3.5-flash`);
    expect(ask).toHaveBeenCalledOnce();
    const request = ask.mock.calls[0][0] as any;
    expect(request).toMatchObject({ from: 'gemini-3.6-flash', to: 'gemini-3.5-flash', reason: 'quota' });
    expect(request.usage).toMatchObject({ keys: 2, exhausted: 2, usedFraction: 1 });
    expect(s.preferred).toBe('gemini-3.6-flash');
  });

  it('stops with a clear error when the user says stop, or when nobody can be asked', async () => {
    const { s } = session();
    s.onFallbackRequest = async () => 'stop';
    failing['*/gemini-3.6-flash'] = 'quota';
    await expect(s.sendUserMessage('hi', {} as any)).rejects.toThrow(QuotaExhaustedError);
    const headless = session().s;
    await expect(headless.sendUserMessage('hi', {} as any)).rejects.toMatchObject({ name: 'QuotaExhaustedError', model: 'gemini-3.6-flash', reason: 'quota' });
  });

  it('"don\'t ask again" turns the automatic fallback on; auto never asks', async () => {
    const { s } = session();
    const policy = vi.fn();
    s.onFallbackRequest = async () => 'always';
    s.onFallbackPolicyChange = policy;
    failing['*/gemini-3.6-flash'] = 'quota';
    expect((await s.sendUserMessage('hi', {} as any)).text).toMatch(/gemini-3\.5-flash$/);
    expect(policy).toHaveBeenCalledWith('auto');

    const auto = session({ modelFallback: 'auto' }).s;
    const ask = vi.fn();
    auto.onFallbackRequest = ask;
    expect((await auto.sendUserMessage('hi', {} as any)).text).toMatch(/gemini-3\.5-flash$/);
    expect(ask).not.toHaveBeenCalled();
  });

  it('off never switches models, even with a dialog available', async () => {
    const { s } = session({ modelFallback: 'off' });
    const ask = vi.fn();
    s.onFallbackRequest = ask;
    failing['*/gemini-3.6-flash'] = 'quota';
    await expect(s.sendUserMessage('hi', {} as any)).rejects.toThrow(QuotaExhaustedError);
    expect(ask).not.toHaveBeenCalled();
  });

  it('waits out per-minute limits on every key instead of asking, then continues on the same model', async () => {
    const { s } = session();
    const ask = vi.fn();
    const waits: Array<number | null> = [];
    s.onFallbackRequest = ask;
    s.onQuotaWait = (ms) => waits.push(ms);
    failing['*/gemini-3.6-flash'] = 'rpm';
    setTimeout(() => { failing = {}; }, 1500);
    expect((await s.sendUserMessage('hi', {} as any)).text).toMatch(/gemini-3\.6-flash$/);
    expect(ask).not.toHaveBeenCalled();
    expect(waits[0]).toBeGreaterThan(0);
    expect(waits.at(-1)).toBeNull();
  }, 20_000);

  it('comes back to the preferred model at the next message once its quota is back', async () => {
    const { s } = session({ modelFallback: 'auto' });
    const changed = vi.fn();
    s.onModelChange = changed;
    failing['*/gemini-3.6-flash'] = 'quota';
    expect((await s.sendUserMessage('hi', {} as any)).text).toMatch(/gemini-3\.5-flash$/);
    failing = {};
    vi.setSystemTime(Date.now() + 25 * 3600_000); // past the daily reset
    try {
      expect((await s.sendUserMessage('again', {} as any)).text).toMatch(/gemini-3\.6-flash$/);
      expect(changed).toHaveBeenLastCalledWith('gemini-3.5-flash', 'gemini-3.6-flash', 'back');
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks after 3 overloaded answers, and "keep trying" stays on the model', async () => {
    const { s } = session();
    const ask = vi.fn(async () => 'switch' as const);
    s.onFallbackRequest = ask;
    failing['*/gemini-3.6-flash'] = 'overloaded';
    expect((await s.sendUserMessage('hi', {} as any)).text).toMatch(/gemini-3\.5-flash$/);
    expect(ask.mock.calls[0][0]).toMatchObject({ reason: 'overloaded', to: 'gemini-3.5-flash' });
  }, 30_000);
});

describe('quota texts', () => {
  it('writes one bar and a reset time, never the keys', () => {
    const usage = { model: 'gemini-3.6-flash', keys: 10, exhausted: 9, refused: 2, usedFraction: 0.9, resetsAt: Date.now() + 3 * 3600_000 + 4 * 60_000, overloaded: false };
    expect(quotaBar(0.9, 10)).toBe('█████████░');
    expect(usageSummary(usage)).toMatch(/^90% used · resets in 3h 0[34]m · 2 keys refused$/);
    const err = new QuotaExhaustedError('gemini-3.6-flash', 'quota', usage);
    expect(quotaMessage(err)).toMatch(/^Usage limit reached for Gemini 3\.6 Flash\. Access resets in 3h 0[34]m\.\n\/model to switch models · \/status for usage\.$/);
    expect(formatDuration(45_000)).toBe('45s');
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
