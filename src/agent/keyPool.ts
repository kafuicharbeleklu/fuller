import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { errorStatus } from './retry.js';
import { CONFIG_DIR_NAME } from '../branding.js';

/**
 * Quota scheduler for several Gemini API keys (GEMINI_API_KEYS=k1,k2,k3) and a chain of models.
 *
 * Google counts quotas per project *and* per model: a key out of quota for one model still
 * works for the others. So a quota error rests only the (key, model) pair; a refused key
 * (project denied, invalid, expired) rests for every model; an overloaded model (503) rests
 * briefly for every key. Each request takes the first model of the chain that has a usable
 * key and fits the conversation, staying on the current key while it works (cache). The
 * resting state survives restarts, stored by key fingerprint (never the key itself).
 */

export interface Route {
  key: string;
  keyIndex: number;
  model: string;
}

export function keyStateFile(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME, 'key-state.json');
}
const fingerprint = (key: string) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
const ANY_MODEL = '*';

export class QuotaScheduler {
  private current = 0;
  /** "fingerprint|model" (or "fingerprint|*" for a refused key) → resting until. */
  private readonly resting = new Map<string, number>();
  /** Overloaded models → resting until (every key). */
  private readonly overloaded = new Map<string, number>();

  constructor(readonly keys: string[], private readonly now: () => number = Date.now, private readonly stateFile?: string) {
    if (!stateFile) return;
    try {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, number>;
      for (const [id, until] of Object.entries(saved)) {
        // Older files stored a key fingerprint alone: it meant the whole key.
        if (until > this.now()) this.resting.set(id.includes('|') ? id : `${id}|${ANY_MODEL}`, until);
      }
    } catch {}
  }

  get size(): number { return this.keys.length; }
  /** Position of the key in use (1-based). */
  get position(): number { return this.current + 1; }

  private restKey(index: number, model: string): string { return `${fingerprint(this.keys[index])}|${model}`; }

  /** A key usable now for this model. */
  usable(index: number, model: string): boolean {
    const t = this.now();
    return (this.resting.get(this.restKey(index, ANY_MODEL)) ?? 0) <= t && (this.resting.get(this.restKey(index, model)) ?? 0) <= t;
  }

  /** The model has a usable key and is not resting as overloaded. */
  modelAvailable(model: string): boolean {
    return (this.overloaded.get(model) ?? 0) <= this.now() && this.keys.some((_, i) => this.usable(i, model));
  }

  /**
   * The route for the next request: the first model of the chain that fits and has a usable
   * key, on the current key when possible. null when everything is resting or too small.
   */
  pick(chain: string[], fits: (model: string) => boolean = () => true): Route | null {
    for (const model of chain) {
      if ((this.overloaded.get(model) ?? 0) > this.now() || !fits(model)) continue;
      for (let step = 0; step < this.keys.length; step++) {
        const index = (this.current + step) % this.keys.length;
        if (this.usable(index, model)) {
          this.current = index;
          return { key: this.keys[index], keyIndex: index, model };
        }
      }
    }
    return null;
  }

  /** The (key, model) pair ran out of quota. */
  markQuota(keyIndex: number, model: string, err: unknown): void {
    this.resting.set(this.restKey(keyIndex, model), this.now() + restDelayMs(err));
    this.save();
  }

  /** The key itself is refused (project denied, invalid, expired): every model. */
  markDead(keyIndex: number, err: unknown): void {
    this.resting.set(this.restKey(keyIndex, ANY_MODEL), this.now() + restDelayMs(err));
    this.save();
  }

  /** The model keeps answering 503: try the others for a while. */
  markOverloaded(model: string, ms = 2 * 60_000): void {
    this.overloaded.set(model, this.now() + ms);
  }

  private save(): void {
    if (!this.stateFile) return;
    try {
      const state: Record<string, number> = {};
      for (const [id, until] of this.resting) if (until > this.now()) state[id] = until;
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify(state), { mode: 0o600 });
    } catch {}
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

/** The model is overloaded on Google's side (not a quota). */
export function isOverloadError(err: any): boolean {
  return errorStatus(err) === 503 || /UNAVAILABLE|high demand|overloaded/i.test(String(err?.message ?? err ?? ''));
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

const schedulers = new Map<string, QuotaScheduler>();

/** One scheduler per set of keys, shared by the main session, subagents and side calls. */
export function schedulerFor(keys: string[]): QuotaScheduler {
  const id = keys.join('\n');
  let scheduler = schedulers.get(id);
  if (!scheduler) { scheduler = new QuotaScheduler(keys, () => Date.now(), keyStateFile()); schedulers.set(id, scheduler); }
  return scheduler;
}
