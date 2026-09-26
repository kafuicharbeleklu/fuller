import { describe, expect, it } from 'vitest';
import { transformChunk, eraseLines, physicalRows, composeRepaint, type FrameWriterState } from '../src/ui/frameWriter.js';

const frame = (lines: string[]) => lines.join('\n') + '\n';

describe('frameWriter', () => {
  it('passes the first frame through unchanged', () => {
    const state: FrameWriterState = { lastFrame: [], expectStatic: false };
    const out = transformChunk(frame(['a', 'b']), state, 80, true);
    expect(out).toBe('a\nb');
    expect(state.lastFrame).toEqual(['a', 'b']);
  });

  it('keeps Ink erase counts when nothing wrapped, but uses EL 0 instead of EL 2', () => {
    const state: FrameWriterState = { lastFrame: ['a', 'b'], expectStatic: false };
    const inkErase = '\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[G';
    const out = transformChunk(inkErase + frame(['c']), state, 80, true);
    expect(out).toBe(eraseLines(2) + 'c');
    expect(out).not.toContain('\x1b[2K');
    expect((out.match(/\x1b\[K/g) ?? []).length).toBe(2);
  });

  it('erases the physical rows after the terminal shrank', () => {
    const wide = 'x'.repeat(150);
    const state: FrameWriterState = { lastFrame: [wide, 'short'], expectStatic: false };
    // Ink thinks 3 rows (2 lines + cursor row); the cursor sits on the last row and at 80 columns the wide line takes 2 rows → 3.
    const inkErase = '\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[G';
    const out = transformChunk(inkErase + frame(['n']), state, 80, true);
    expect(out.startsWith(eraseLines(3))).toBe(true);
    expect(physicalRows([wide, 'short'], 80)).toBe(3);
    expect(physicalRows([wide, 'short'], 200)).toBe(2);
  });

  it('ignores ANSI colours when measuring', () => {
    const coloured = '\x1b[32m' + 'y'.repeat(100) + '\x1b[39m';
    expect(physicalRows([coloured], 50)).toBe(2);
  });

  it('does not track static output or cursor sequences as frames', () => {
    const state: FrameWriterState = { lastFrame: ['a'], expectStatic: false };
    transformChunk('\x1b[?25l', state, 80, true);
    expect(state.lastFrame).toEqual(['a']);
    transformChunk('\x1b[2K\x1b[1A\x1b[2K\x1b[G', state, 80, true); // log.clear()
    expect(state.expectStatic).toBe(true);
    transformChunk('static line 1\nstatic line 2\n', state, 80, true);
    expect(state.lastFrame).toEqual([]);
    expect(state.expectStatic).toBe(false);
    transformChunk(frame(['dyn']), state, 80, true);
    expect(state.lastFrame).toEqual(['dyn']);
  });

  it('resets after a screen clear', () => {
    const state: FrameWriterState = { lastFrame: ['a', 'b'], expectStatic: false };
    transformChunk('\x1b[2J\x1b[H', state, 80, true);
    expect(state.lastFrame).toEqual([]);
  });

  it('honours the no-reflow mode', () => {
    const wide = 'x'.repeat(150);
    expect(physicalRows([wide], 80, false)).toBe(1);
  });

  it('composes a repaint that fills the screen from the tail', () => {
    const tail = ['t1', 't2', 't3', 'x'.repeat(100), 't5'];
    const frame = ['', '╭─╮', '│ │', '╰─╯', 'footer'];
    const out = composeRepaint(tail, frame, 10, 80);
    expect(out).not.toContain('\x1b[2J');
    // 10 rows − 5 frame rows = 5 rows available: t5 (1) + wide line (2) + t3 (1) + t2 (1) = 5 → t1 dropped.
    expect(out).toContain('\x1b[1;1Ht2');
    expect(out).toContain('\x1b[2;1Ht3');
    expect(out).toContain('\x1b[3;1H' + 'x'.repeat(100));
    expect(out).toContain('\x1b[5;1Ht5');
    expect(out).toContain('\x1b[6;1H\x1b[7;1H╭─╮');
    expect(out).not.toContain('t1');
    expect(out.endsWith('\x1b[10;1Hfooter')).toBe(true);
    expect((out.match(/\x1b\[K/g) ?? []).length).toBe(10);
  });

  it('repaints only the frame when nothing fits above it', () => {
    const out = composeRepaint(['a', 'b'], ['l1', 'l2', 'l3'], 3, 80);
    expect(out).toBe('\x1b[1;1H\x1b[K\x1b[2;1H\x1b[K\x1b[3;1H\x1b[K\x1b[1;1Hl1\x1b[2;1Hl2\x1b[3;1Hl3');
  });
});

describe('fullscreen frames as tall as the terminal (26/09)', () => {
  it('repaints them in place, every row, without erasing the screen or the scrollback', async () => {
    const { transformChunk, inPlaceFrame } = await import('../src/ui/frameWriter.js');
    const state = { lastFrame: [] as string[], expectStatic: false, fullscreen: true };
    const frame = ['top', 'middle', '─'.repeat(10)].join('\n') + '\n';
    const out = transformChunk('\x1b[2J\x1b[3J\x1b[H' + frame, state, 10, true, 3);
    expect(out).not.toContain('\x1b[2J');
    expect(out).not.toContain('\x1b[3J');
    // Short rows are cleared to their end; the full-width rule is not (erasing there would take its last cell).
    expect(out).toBe('\x1b[1;1Htop\x1b[K\x1b[2;1Hmiddle\x1b[K\x1b[3;1H──────────');
    expect(state.lastFrame).toEqual(['top', 'middle', '─'.repeat(10)]);
    expect(inPlaceFrame(['a'], 2, 5)).toBe('\x1b[1;1Ha\x1b[K\x1b[2;1H\x1b[K');
  });

  it('leaves Ink\'s clear alone outside fullscreen', async () => {
    const { transformChunk } = await import('../src/ui/frameWriter.js');
    const state = { lastFrame: [] as string[], expectStatic: false, fullscreen: false };
    const chunk = '\x1b[2J\x1b[3J\x1b[Hframe\n';
    expect(transformChunk(chunk, state, 10, true, 3)).toBe(chunk);
  });
});
