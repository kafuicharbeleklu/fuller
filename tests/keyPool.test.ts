import { describe, expect, it, vi } from 'vitest';

const used: string[] = [];
vi.mock('@google/genai', async (importOriginal) => {
  const real: any = await importOriginal();
  class GoogleGenAI {
    constructor(private opts: { apiKey: string }) {}
    chats = {
      create: ({ history }: { history?: unknown[] }) => ({
        getHistory: () => history ?? [],
        sendMessageStream: async () => {
          used.push(this.opts.apiKey);
          if (this.opts.apiKey === 'key-A') throw Object.assign(new Error('{"error":{"code":429,"message":"You exceeded your current quota. Please retry in 37s.","status":"RESOURCE_EXHAUSTED"}}'), { status: 429 });
          return (async function* () { yield { candidates: [{ content: { parts: [{ text: 'hello from B' }] } }] }; })();
        },
      }),
    };
    models = {};
  }
  return { ...real, GoogleGenAI };
});

import { KeyPool, collectApiKeys, isQuotaError, restDelayMs } from '../src/agent/keyPool.js';
import { withRetry } from '../src/agent/retry.js';
import { GeminiAgentSession } from '../src/agent/gemini.js';
import { getConfig } from '../src/config.js';

describe('several API keys', () => {
  it('collects the keys from the environment, main key first, without duplicates', () => {
    expect(collectApiKeys({ GEMINI_API_KEY: 'a', GEMINI_API_KEYS: 'b, c,a', GEMINI_API_KEY_2: 'd' } as any)).toEqual(['a', 'b', 'c', 'd']);
    expect(collectApiKeys({} as any, 'x')).toEqual(['x']);
  });

  it('rests an exhausted key and moves to the next usable one', () => {
    let now = 0;
    const pool = new KeyPool(['a', 'b', 'c'], () => now);
    const quota = new Error('429 Quota exceeded, retry in 30s');
    expect(pool.rotate(quota)).toBe(true);
    expect(pool.current()).toBe('b');
    expect(pool.rotate(quota)).toBe(true);
    expect(pool.current()).toBe('c');
    expect(pool.rotate(quota)).toBe(false); // a and b still rest
    now = 31_000;
    expect(pool.rotate(quota)).toBe(true);
    expect(pool.current()).toBe('a');
    expect(new KeyPool(['only']).rotate(quota)).toBe(false);
  });

  it('tells quota errors apart and reads how long to rest', () => {
    expect(isQuotaError(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(isQuotaError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
    expect(isQuotaError(Object.assign(new Error('overloaded'), { status: 503 }))).toBe(false);
    expect(restDelayMs(new Error('Please retry in 37.2s'))).toBe(37_200);
    expect(restDelayMs(new Error('Quota exceeded for metric GenerateRequestsPerDayPerProject'))).toBe(3_600_000);
  });

  it('retries at once, without an attempt or a wait, when the cause is fixed', async () => {
    let calls = 0;
    const onRetry = vi.fn();
    const result = await withRetry(async () => { calls++; if (calls === 1) throw Object.assign(new Error('quota'), { status: 429 }); return 'ok'; }, { recover: () => true, onRetry, maxAttempts: 1 });
    expect(result).toBe('ok');
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('moves a conversation to the next key when the first one runs out of quota', async () => {
    const config = { ...getConfig({ workspaceDir: process.cwd(), apiKey: 'key-A' }), apiKeys: ['key-A', 'key-B'] };
    const session = new GeminiAgentSession(config as any);
    const switched = vi.fn();
    session.onKeySwitch = switched;
    const turn = await session.sendUserMessage('hi', {} as any);
    expect(turn.text).toBe('hello from B');
    expect(used).toEqual(['key-A', 'key-B']);
    expect(switched).toHaveBeenCalledWith(2, 2);
    expect(session.keyStatus).toEqual({ position: 2, total: 2 });
  });
});
