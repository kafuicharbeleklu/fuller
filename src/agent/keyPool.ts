import { errorStatus } from './retry.js';

/**
 * Several Gemini API keys (GEMINI_API_KEYS=k1,k2,k3): when one runs out of quota,
 * calls move to the next one at once instead of retrying the exhausted key.
 * An exhausted key rests for the delay Google gives (or an hour for a daily
 * quota) before it is tried again. Keys are never shown, only their position.
 */
export class KeyPool {
  private index = 0;
  private readonly restingUntil = new Map<number, number>();

  constructor(readonly keys: string[], private readonly now: () => number = Date.now) {}

  get size(): number { return this.keys.length; }
  get position(): number { return this.index + 1; }
  current(): string { return this.keys[this.index] ?? ''; }

  /**
   * The current key hit its quota: rest it and move to the next usable one.
   * Returns false when no other key is available (the caller then backs off).
   */
  rotate(err: unknown): boolean {
    if (this.keys.length < 2) return false;
    this.restingUntil.set(this.index, this.now() + restDelayMs(err));
    for (let step = 1; step < this.keys.length; step++) {
      const next = (this.index + step) % this.keys.length;
      if ((this.restingUntil.get(next) ?? 0) <= this.now()) {
        this.index = next;
        return true;
      }
    }
    return false;
  }
}

/** A quota or rate-limit error (as opposed to an overloaded server). */
export function isQuotaError(err: any): boolean {
  if (errorStatus(err) === 429) return true;
  return /resource_exhausted|quota/i.test(String(err?.message ?? err ?? ''));
}

/** How long an exhausted key rests: Google's retry delay, an hour for a daily quota, else a minute. */
export function restDelayMs(err: any): number {
  const text = String(err?.message ?? err ?? '');
  if (/per ?day|PerDay|daily/i.test(text)) return 60 * 60_000;
  const retry = text.match(/retry(?:Delay)?[^0-9]{0,12}(\d+(?:\.\d+)?)\s*s/i);
  if (retry) return Math.max(5_000, Math.ceil(Number(retry[1]) * 1000));
  return 60_000;
}

/** Every configured key, first the main one, without duplicates or blanks. */
export function collectApiKeys(env: NodeJS.ProcessEnv, main?: string): string[] {
  const listed = [
    main,
    env.GEMINI_API_KEY,
    ...(env.GEMINI_API_KEYS ?? '').split(/[\s,;]+/),
    ...Array.from({ length: 8 }, (_, i) => env[`GEMINI_API_KEY_${i + 2}`]),
    env.GOOGLE_API_KEY,
  ];
  return [...new Set(listed.map((k) => (k ?? '').trim()).filter(Boolean))];
}

const pools = new Map<string, KeyPool>();

/** One pool per set of keys, shared by the main session, subagents and side calls. */
export function keyPoolFor(keys: string[]): KeyPool {
  const id = keys.join('\n');
  let pool = pools.get(id);
  if (!pool) { pool = new KeyPool(keys); pools.set(id, pool); }
  return pool;
}
