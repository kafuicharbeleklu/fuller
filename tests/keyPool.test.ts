import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { QuotaScheduler, collectApiKeys, isQuotaError, isKeyError, restDelayMs } from '../src/agent/keyPool.js';
import { modelChain, contextWindowOf, DEFAULT_MODEL_CHAIN } from '../src/agent/models.js';
import { withRetry } from '../src/agent/retry.js';
const require = createRequire(import.meta.url);

const quota = Object.assign(new Error('429 Quota exceeded for metric GenerateRequestsPerDayPerProjectPerModel'), { status: 429 });
const denied = Object.assign(new Error('{"error":{"code":403,"message":"Your project has been denied access. Please contact support."}}'), { status: 403 });

describe('quota scheduler (per key and per model)', () => {
  it('rests only the (key, model) pair on a quota error: the key still serves other models', () => {
    const s = new QuotaScheduler(['a', 'b'], () => 0);
    s.markQuota(0, 'gemini-3.6-flash', quota);
    expect(s.usable(0, 'gemini-3.6-flash')).toBe(false);
    expect(s.usable(0, 'gemini-3.7-flash')).toBe(true);
    expect(s.pick(['gemini-3.6-flash'])).toMatchObject({ key: 'b', model: 'gemini-3.6-flash' });
  });

  it('walks the chain: every key of a model, then the next model, then nothing', () => {
    const s = new QuotaScheduler(['a', 'b'], () => 0);
    const chain = ['gemini-3.6-flash', 'gemma-4-26b-a4b-it'];
    s.markQuota(0, chain[0], quota);
    s.markQuota(1, chain[0], quota);
    expect(s.pick(chain)).toMatchObject({ model: 'gemma-4-26b-a4b-it' });
    s.markQuota(0, chain[1], quota);
    s.markQuota(1, chain[1], quota);
    expect(s.pick(chain)).toBeNull();
  });

  it('rests a refused key for every model, and an overloaded model for every key', () => {
    let now = 0;
    const s = new QuotaScheduler(['a', 'b'], () => now);
    s.markDead(0, denied);
    expect(s.usable(0, 'any-model')).toBe(false);
    s.markOverloaded('gemini-3.6-flash', 120_000);
    expect(s.pick(['gemini-3.6-flash', 'gemini-3.5-flash'])).toMatchObject({ key: 'b', model: 'gemini-3.5-flash' });
    now = 121_000;
    expect(s.pick(['gemini-3.6-flash'])).toMatchObject({ model: 'gemini-3.6-flash' });
  });

  it('skips models too small for the conversation', () => {
    const s = new QuotaScheduler(['a'], () => 0);
    expect(s.pick(['gemma-4-26b-a4b-it', 'gemini-3.6-flash'], (m) => m.startsWith('gemini'))).toMatchObject({ model: 'gemini-3.6-flash' });
  });

  it('remembers resting pairs between launches, by fingerprint only (older files too)', () => {
    const file = require('node:path').join(require('node:os').tmpdir(), `fuller-quota-${process.pid}.json`);
    const first = new QuotaScheduler(['secret-a', 'secret-b'], () => 1_000, file);
    first.markQuota(0, 'gemini-3.6-flash', quota);
    const saved = require('node:fs').readFileSync(file, 'utf8');
    expect(saved).not.toContain('secret');
    const next = new QuotaScheduler(['secret-a', 'secret-b'], () => 2_000, file);
    expect(next.usable(0, 'gemini-3.6-flash')).toBe(false);
    expect(next.usable(0, 'gemini-3.7-flash')).toBe(true);
    require('node:fs').rmSync(file, { force: true });
  });
});

describe('model chain and windows', () => {
  it('starts from the preferred model; off keeps it alone; the older single fallback still works', () => {
    expect(modelChain('gemini-3.6-flash', {})).toEqual(['gemini-3.6-flash', ...DEFAULT_MODEL_CHAIN.filter((m) => m !== 'gemini-3.6-flash')]);
    expect(modelChain('gemini-3.6-flash', { fallbackModels: 'off' })).toEqual(['gemini-3.6-flash']);
    expect(modelChain('gemini-3.6-flash', { fallbackModel: 'gemma-4-31b-it' })).toEqual(['gemini-3.6-flash', 'gemma-4-31b-it']);
    expect(contextWindowOf('gemma-4-26b-a4b-it')).toBe(262_144);
  });
});

describe('errors and keys', () => {
  it('collects the keys from the environment, main key first, without duplicates', () => {
    expect(collectApiKeys({ GEMINI_API_KEY: 'a', GEMINI_API_KEYS: 'b, c,a', GEMINI_API_KEY_2: 'd' } as any)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reads how long to rest', () => {
    expect(isQuotaError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
    expect(isKeyError(denied)).toBe(true);
    expect(isKeyError(Object.assign(new Error('overloaded'), { status: 503 }))).toBe(false);
    expect(restDelayMs(new Error('Please retry in 37.2s'))).toBe(37_200);
    expect(restDelayMs(quota)).toBe(3_600_000);
    expect(restDelayMs(denied)).toBe(24 * 3_600_000);
  });

  it('retries at once, without an attempt or a wait, when the cause is fixed', async () => {
    let calls = 0;
    const result = await withRetry(async () => { calls++; if (calls === 1) throw quota; return 'ok'; }, { recover: () => true, maxAttempts: 1 });
    expect(result).toBe('ok');
  });
});
