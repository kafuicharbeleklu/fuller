import { describe, expect, it } from 'vitest';
import { parseKeys } from '../src/ui/useRawInput.js';

describe('parseKeys', () => {
  it('parses printable runs and control keys', () => {
    expect(parseKeys('ab').map((k) => [k.name, k.text])).toEqual([['char', 'ab']]);
    expect(parseKeys('\r')[0].name).toBe('return');
    expect(parseKeys('\n')[0]).toMatchObject({ name: 'return', ctrl: true });
    expect(parseKeys('\x7f')[0].name).toBe('backspace');
    expect(parseKeys('\x03')[0]).toMatchObject({ name: 'char', text: 'c', ctrl: true });
    expect(parseKeys('\x1f')[0]).toMatchObject({ name: 'char', text: '_', ctrl: true });
  });
  it('parses CSI sequences with modifiers', () => {
    expect(parseKeys('\x1b[A')[0].name).toBe('up');
    expect(parseKeys('\x1b[1;5C')[0]).toMatchObject({ name: 'right', ctrl: true });
    expect(parseKeys('\x1b[H')[0].name).toBe('home');
    expect(parseKeys('\x1b[F')[0].name).toBe('end');
    expect(parseKeys('\x1b[3~')[0].name).toBe('delete');
    expect(parseKeys('\x1b[Z')[0]).toMatchObject({ name: 'tab', shift: true });
    expect(parseKeys('\x1b[13;2u')[0]).toMatchObject({ name: 'return', shift: true });
    expect(parseKeys('\x1b[27;2;13~')[0]).toMatchObject({ name: 'return', shift: true });
  });
  it('parses alt combinations and lone escape', () => {
    expect(parseKeys('\x1bb')[0]).toMatchObject({ name: 'char', text: 'b', alt: true });
    expect(parseKeys('\x1b\r')[0]).toMatchObject({ name: 'return', alt: true });
    expect(parseKeys('\x1b')[0].name).toBe('escape');
  });
  it('splits concatenated sequences', () => {
    const keys = parseKeys('\x1b[A\x1b[Ax');
    expect(keys.map((k) => k.name)).toEqual(['up', 'up', 'char']);
  });
  it('handles bracketed paste', () => {
    const keys = parseKeys('\x1b[200~line1\nline2\x1b[201~');
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ name: 'paste', text: 'line1\nline2' });
  });
});
