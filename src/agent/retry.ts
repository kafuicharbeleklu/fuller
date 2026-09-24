export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: Error;
  status?: number;
}

export function errorStatus(err: any): number | undefined {
  if (!err) return undefined;
  if (typeof err.status === 'number') return err.status;
  if (typeof err.code === 'number') return err.code;
  const m = String(err.message ?? '').match(/\b(429|500|502|503|504)\b/);
  return m ? Number(m[1]) : undefined;
}

export function isRetryable(err: any): boolean {
  const status = errorStatus(err);
  if (status && [429, 500, 502, 503, 504].includes(status)) return true;
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  return /resource_exhausted|unavailable|overloaded|fetch failed|econnreset|etimedout|socket hang up|network|deadline/.test(msg);
}

export function describeError(err: any): string {
  const status = errorStatus(err);
  let msg = String(err?.message ?? err ?? 'Unknown error');
  // The SDK can wrap a JSON error message in another JSON error envelope.
  for (let depth = 0; depth < 4; depth++) {
    try {
      const parsed = JSON.parse(msg);
      const inner = parsed?.error?.message ?? parsed?.message;
      if (typeof inner !== 'string' || inner === msg) break;
      msg = inner;
    } catch { break; }
  }
  msg = msg.replace(/\s+/g, ' ').trim();
  if (msg.length > 300) msg = msg.slice(0, 300) + '…';
  // Claude Code's final form: "API Error: 500 Internal server error".
  return status ? `API Error: ${status} ${msg}` : msg;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: { signal?: AbortSignal; onRetry?: (info: RetryInfo) => void; onAttempt?: () => void; maxAttempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  // Claude Code retries transient failures up to 10 times with exponential backoff.
  const maxAttempts = options.maxAttempts ?? 10;
  const base = options.baseDelayMs ?? 1000;
  let attempt = 0;
  for (;;) {
    attempt++;
    if (options.signal?.aborted) throw new Error('Interrupted');
    options.onAttempt?.();
    try {
      return await fn(attempt);
    } catch (err: any) {
      if (options.signal?.aborted || err?.message === 'Interrupted' || err?.name === 'AbortError') throw new Error('Interrupted');
      if (attempt >= maxAttempts || !isRetryable(err)) throw err;
      const jitter = Math.random() * 500;
      const delayMs = Math.min(30_000, base * 2 ** (attempt - 1)) + jitter;
      options.onRetry?.({ attempt, maxAttempts, delayMs, error: err, status: errorStatus(err) });
      await sleep(delayMs, options.signal);
    }
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Interrupted')); return; }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('Interrupted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
