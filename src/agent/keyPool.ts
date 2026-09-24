import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { errorStatus } from './retry.js';
import { CONFIG_DIR_NAME } from '../branding.js';

/** Where resting keys are remembered between launches, by fingerprint (never the key). */
export function keyStateFile(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME, 'key-state.json');
}
const fingerprint = (key: string) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);

/**
 * Several Gemini API keys (GEMINI_API_KEYS=k1,k2,k3): when one runs out of quota,
 * or its project is denied access, calls move to the next one at once instead of
 * retrying it. An exhausted key rests for the delay Google gives (an hour for a
 * daily quota); an unusable one for a day. Keys are never shown, only their position.
 */
export class KeyPool {
  private index = 0;
  private readonly restingUntil = new Map<number, number>();

  constructor(readonly keys: string[], private readonly now: () => number = Date.now, private readonly stateFile?: string) {
    // Start on a key that is not resting, as the last launch left them.
    if (!stateFile || keys.length < 2) return;
    try {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, number>;
      keys.forEach((key, i) => { const until = saved[fingerprint(key)]; if (until && until > this.now()) this.restingUntil.set(i, until); });
      const first = keys.findIndex((_, i) => (this.restingUntil.get(i) ?? 0) <= this.now());
      if (first >= 0) this.index = first;
    } catch {}
  }

  private save(): void {
    if (!this.stateFile) return;
    try {
      const state: Record<string, number> = {};
      for (const [i, until] of this.restingUntil) if (until > this.now()) state[fingerprint(this.keys[i])] = until;
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify(state), { mode: 0o600 });
    } catch {}
  }

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
    this.save();
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

/** The key itself is unusable: its project was denied access, or the key is invalid or expired. */
export function isDeadKeyError(err: any): boolean {
  const text = String(err?.message ?? err ?? '');
  return /denied access|API key not valid|API_KEY_INVALID|API key expired|PERMISSION_DENIED|API_KEY_SERVICE_BLOCKED|consumer .* has been suspended/i.test(text);
}

/** Errors another key can fix. */
export function isKeyError(err: any): boolean {
  return isQuotaError(err) || isDeadKeyError(err);
}

/** How long a key rests: a day when unusable, Google's retry delay, an hour for a daily quota, else a minute. */
export function restDelayMs(err: any): number {
  if (isDeadKeyError(err)) return 24 * 60 * 60_000;
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
  if (!pool) { pool = new KeyPool(keys, Date.now, keyStateFile()); pools.set(id, pool); }
  return pool;
}
