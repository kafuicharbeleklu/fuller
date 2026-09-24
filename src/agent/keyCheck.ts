import { GoogleGenAI } from '@google/genai';
import { errorStatus } from './retry.js';

export type KeyHealth = 'ok' | 'slow' | 'quota' | 'denied' | 'invalid' | 'overloaded' | 'no answer' | 'error';

export interface KeyCheck {
  position: number;
  kind: 'AIza' | 'AQ.' | 'other';
  health: KeyHealth;
  seconds: number;
  detail?: string;
}

/** Sort an API error into what it means for the key. */
export function classifyKeyError(err: any): { health: KeyHealth; detail: string } {
  const text = String(err?.message ?? err ?? '');
  const status = errorStatus(err);
  if (/denied access/i.test(text)) return { health: 'denied', detail: 'project denied access by Google (403)' };
  if (/API key not valid|API_KEY_INVALID|API key expired/i.test(text)) return { health: 'invalid', detail: 'key invalid or expired' };
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(text)) return { health: 'quota', detail: /per ?day|PerDay/i.test(text) ? 'daily quota reached' : 'quota reached (per minute or per day)' };
  if (status === 503 || /UNAVAILABLE|high demand|overloaded/i.test(text)) return { health: 'overloaded', detail: 'model overloaded on Google\'s side (503), not the key' };
  const clean = text.replace(/AQ\.[\w.-]+|AIza[\w-]+/g, '<key>').replace(/\s+/g, ' ').slice(0, 100);
  return { health: 'error', detail: `${status ?? ''} ${clean}`.trim() };
}

/**
 * `fuller --check-keys`: one tiny request per key (a few tokens) to see which keys work,
 * are out of quota or were refused. Keys are identified by position, never shown.
 */
export async function checkKeys(keys: string[], model: string, options: { timeoutMs?: number; slowMs?: number; onResult?: (r: KeyCheck) => void } = {}): Promise<KeyCheck[]> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const slowMs = options.slowMs ?? 20_000;
  const results: KeyCheck[] = [];
  for (const [i, key] of keys.entries()) {
    const kind = key.startsWith('AIza') ? 'AIza' : key.startsWith('AQ.') ? 'AQ.' : 'other';
    const started = Date.now();
    let result: KeyCheck;
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        ai.models.generateContent({ model, contents: 'Reply with ok.', config: { maxOutputTokens: 5 } }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('__timeout__')), timeoutMs); }),
      ]).finally(() => clearTimeout(timer));
      const seconds = (Date.now() - started) / 1000;
      result = { position: i + 1, kind, health: seconds * 1000 > slowMs ? 'slow' : 'ok', seconds };
    } catch (err: any) {
      const seconds = (Date.now() - started) / 1000;
      result = err?.message === '__timeout__'
        ? { position: i + 1, kind, health: 'no answer', seconds, detail: `no answer in ${Math.round(timeoutMs / 1000)} s` }
        : { position: i + 1, kind, seconds, ...classifyKeyError(err) };
    }
    results.push(result);
    options.onResult?.(result);
  }
  return results;
}
