import { describe, expect, it } from 'vitest';
import { changedWords, backgroundRange, diffRows } from '../src/ui/DiffView.js';

// Claude Code 2.1.283's /theme preview: "World" and "Claude" on a brighter background in the modified line.
describe('word diff inside a modified line', () => {
  it('finds the words that changed between a removed line and its added line', () => {
    const before = '  console.log("Hello, World!");';
    const after = '  console.log("Hello, Claude!");';
    const words = changedWords(before, after)!;
    expect(before.slice(...words.removed)).toBe('World');
    expect(after.slice(...words.added)).toBe('Claude');
    expect(changedWords('abc', 'xyz')).toBeNull();
    expect(changedWords('same', 'same')).toBeNull();
    const inserted = changedWords('call(a, b)', 'call(a, x, b)')!;
    expect('call(a, x, b)'.slice(...inserted.added)).toBe('x, ');
  });

  it('pairs removed and added lines one for one, and leaves the rest alone', () => {
    const diff = '--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n function greet() {\n-  console.log("Hello, World!");\n+  console.log("Hello, Claude!");\n }\n';
    const { rows } = diffRows(diff);
    const del = rows.find((r) => r.type === 'del') as any;
    const add = rows.find((r) => r.type === 'add') as any;
    expect(del.text.slice(...del.changed)).toBe('World');
    expect(add.text.slice(...add.changed)).toBe('Claude');
    const uneven = diffRows('--- a/f\n+++ b/f\n@@ -1,1 +1,2 @@\n-one\n+one\n+two\n').rows;
    expect(uneven.every((r: any) => !r.changed)).toBe(true);
  });

  it('puts the background under visible characters only, skipping colour codes', () => {
    const coloured = '\x1b[38;2;230;219;116m"Hello, World!"\x1b[39m';
    const out = backgroundRange(coloured, 8, 13, '#044700');
    expect(out).toBe('\x1b[38;2;230;219;116m"Hello, \x1b[48;2;4;71;0mWorld\x1b[49m!"\x1b[39m');
    expect(backgroundRange('abc', 1, 1, '#044700')).toBe('abc');
  });
});
