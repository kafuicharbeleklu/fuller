import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeError, sleep, withRetry } from '../src/agent/retry.js';

afterEach(() => vi.useRealTimers());

describe('retry lifecycle', () => {
  it('ends each wait before the next request and stops after the final failure', async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const error = Object.assign(new Error('rate limited'), { status: 429 });
    const request = vi.fn(async () => { throw error; });
    const promise = withRetry(request, {
      maxAttempts: 3, baseDelayMs: 10,
      onAttempt: () => states.push('request'),
      onRetry: (info) => states.push(`wait ${info.attempt}`),
    }).catch((failure) => failure);
    await vi.runAllTimersAsync();
    expect(await promise).toBe(error);
    expect(request).toHaveBeenCalledTimes(3);
    expect(states).toEqual(['request', 'wait 1', 'request', 'wait 2', 'request']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('interrupts backoff immediately without sending another request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const request = vi.fn(async () => { throw Object.assign(new Error('busy'), { status: 503 }); });
    const promise = withRetry(request, { signal: controller.signal, onRetry: () => controller.abort() }).catch((error) => error.message);
    expect(await promise).toBe('Interrupted');
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await expect(sleep(1000, controller.signal)).rejects.toThrow('Interrupted');
  });

  it('unwraps nested SDK JSON errors for a readable terminal message', () => {
    const inner = JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota.' } });
    const error = Object.assign(new Error(JSON.stringify({ error: { message: inner } })), { status: 429 });
    expect(describeError(error)).toBe('API Error: 429 You exceeded your current quota.');
  });
});
