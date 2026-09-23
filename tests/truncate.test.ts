import { describe, expect, it } from 'vitest';
import { truncateMiddle, truncateHead, isProbablyBinary } from '../src/tools/truncate.js';

describe('truncation', () => {
  it('keeps head and tail', () => {
    const text = 'a'.repeat(1000) + 'MIDDLE' + 'b'.repeat(1000);
    const out = truncateMiddle(text, 300);
    expect(out.length).toBeLessThan(420);
    expect(out.startsWith('aaaa')).toBe(true);
    expect(out.endsWith('bbbb')).toBe(true);
    expect(out).toContain('characters truncated');
    expect(out).not.toContain('MIDDLE');
  });
  it('leaves short text alone', () => {
    expect(truncateMiddle('hello', 100)).toBe('hello');
    expect(truncateHead('hello', 100)).toBe('hello');
  });
  it('detects binary', () => {
    expect(isProbablyBinary(Buffer.from('plain text'))).toBe(false);
    expect(isProbablyBinary(Buffer.from([0x50, 0x4b, 0x00, 0x01]))).toBe(true);
  });
});
