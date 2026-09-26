import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import { FullscreenTranscript, pillLabel, type ScrollAction } from '../src/ui/FullscreenTranscript.js';

const wrap = (child: React.ReactNode) => <ThemeProvider theme={loadTheme('dark')}>{child}</ThemeProvider>;
const lines = ['❯ first prompt', ...Array.from({ length: 20 }, (_, i) => `answer ${i}`), '❯ second prompt', ...Array.from({ length: 30 }, (_, i) => `reply ${i}`)];
const prompts = [{ line: 0, text: 'first prompt' }, { line: 21, text: 'second prompt' }];

function view(scroll: { id: number; direction: ScrollAction }, itemCount: number, click?: { id: number; row: number }) {
  return wrap(<FullscreenTranscript lines={lines} prompts={prompts} itemCount={itemCount} height={10} width={60} scrollRequest={scroll} clickRequest={click} />);
}
const rows = (frame: string | undefined) => (frame ?? '').split('\n').map((row) => row.trimEnd());

describe('fullscreen sticky prompt and "N new messages" (Claude Code 2.1.283, read in its binary)', () => {
  it('pins the prompt scrolled out above the view, counts what arrives, and clicks bring you back', async () => {
    const screen = render(view({ id: 0, direction: 'down' }, 4));
    await vi.waitFor(() => expect(rows(screen.lastFrame()).at(-1)).toBe('reply 29'));
    expect(screen.lastFrame()).not.toContain('❯ second prompt');

    screen.rerender(view({ id: 1, direction: 'up' }, 4));
    await vi.waitFor(() => expect(rows(screen.lastFrame())[0]).toBe('❯ second prompt'));
    expect(rows(screen.lastFrame()).at(-1)?.trim()).toBe('Jump to bottom (ctrl+end) ↓');
    expect(rows(screen.lastFrame())).toHaveLength(10);

    screen.rerender(view({ id: 1, direction: 'up' }, 6));
    await vi.waitFor(() => expect(rows(screen.lastFrame()).at(-1)?.trim()).toBe('2 new messages (ctrl+end) ↓'));

    // A click on the pinned prompt scrolls to it; the one before it is pinned in turn.
    screen.rerender(view({ id: 1, direction: 'up' }, 6, { id: 1, row: 0 }));
    await vi.waitFor(() => expect(rows(screen.lastFrame())[1]).toBe('❯ second prompt'));
    expect(rows(screen.lastFrame())[0]).toBe('❯ first prompt');

    // A click on the pill goes back to the bottom: no pin, no pill.
    screen.rerender(view({ id: 1, direction: 'up' }, 6, { id: 2, row: 9 }));
    await vi.waitFor(() => expect(rows(screen.lastFrame()).at(-1)).toBe('reply 29'));
    expect(screen.lastFrame()).not.toContain('Jump to bottom');
    expect(rows(screen.lastFrame())[0]).not.toBe('❯ first prompt');

    // Back at the bottom the count starts over.
    screen.rerender(view({ id: 3, direction: 'up' }, 6, { id: 2, row: 9 }));
    await vi.waitFor(() => expect(rows(screen.lastFrame()).at(-1)?.trim()).toBe('Jump to bottom (ctrl+end) ↓'));
    screen.unmount();
  });

  it('shortens the pill on narrow screens as Claude Code does', () => {
    expect(pillLabel(0, 80)).toBe('Jump to bottom (ctrl+end) ↓');
    expect(pillLabel(1, 80)).toBe('1 new message (ctrl+end) ↓');
    expect(pillLabel(3, 24)).toBe('3 new messages ↓');
    expect(pillLabel(3, 12)).toBe('3 new messages');
  });
});
