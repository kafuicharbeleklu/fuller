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
  try {
    const parsed = JSON.parse(msg);
    if (parsed?.error?.message) msg = parsed.error.message;
  } catch {}
  msg = msg.replace(/\s+/g, ' ').trim();
  if (msg.length > 300) msg = msg.slice(0, 300) + '…';
  return status ? `API Error (${status}): ${msg}` : msg;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: { signal?: AbortSignal; onRetry?: (info: RetryInfo) => void; maxAttempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 5;
  const base = options.baseDelayMs ?? 1000;
  let attempt = 0;
  for (;;) {
    attempt++;
    if (options.signal?.aborted) throw new Error('Interrupted');
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
