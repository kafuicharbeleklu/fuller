import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { FullscreenTranscript, type ScrollAction } from '../src/ui/FullscreenTranscript.js';
import { Pager } from '../src/ui/Pager.js';

afterEach(cleanup);
const settle = () => new Promise((resolve) => setTimeout(resolve, 35));
const lines = Array.from({ length: 100 }, (_, index) => `row-${index.toString().padStart(3, '0')}`);

describe('transcript navigation', () => {
  it('scrolls by half pages or wheel lines and restores following only at the bottom', async () => {
    let id = 0;
    let currentLines = lines;
    const element = (direction: ScrollAction) => <FullscreenTranscript lines={currentLines} height={11} scrollRequest={{ id: id++, direction }} />;
    const screen = render(element('up'));
    await settle();
    expect(screen.lastFrame()).toContain('row-090');
    screen.rerender(element('up'));
    await settle();
    expect(screen.lastFrame()).toContain('row-085');
    screen.rerender(element('lineUp'));
    await settle();
    expect(screen.lastFrame()).toContain('row-082');
    currentLines = [...lines, 'new output'];
    screen.rerender(<FullscreenTranscript lines={currentLines} height={11} scrollRequest={{ id: id - 1, direction: 'lineUp' }} />);
    await settle();
    expect(screen.lastFrame()).toContain('row-082');
    screen.rerender(element('top'));
    await settle();
    expect(screen.lastFrame()).toContain('row-000');
    screen.rerender(element('bottom'));
    await settle();
    expect(screen.lastFrame()).toContain('new output');
    expect(screen.lastFrame()).not.toContain('scrolled up');
  });

  it('provides half-page and full-page navigation in the viewer', async () => {
    const screen = render(<Pager title='Transcript' lines={lines} onClose={() => {}} />);
    await settle();
    screen.stdin.write('g'); await settle();
    // 24 rows: 21 content rows above the rule and status line, so half a page is 10 rows.
    screen.stdin.write('\x04'); await settle();
    expect(screen.lastFrame()).toContain('row-010');
    expect(screen.lastFrame()).not.toContain('row-009');
    screen.stdin.write('\x06'); await settle();
    expect(screen.lastFrame()).toContain('row-031');
    screen.stdin.write('\x02'); await settle();
    expect(screen.lastFrame()).toContain('row-010');
  });

  it('opens an editor and restores terminal ownership after scrollback export', async () => {
    const restore = vi.fn();
    const exported = vi.fn(() => restore);
    const editor = vi.fn();
    const close = vi.fn();
    const screen = render(<Pager title='Transcript' lines={['❯ hello', '⏺ world']} onClose={close} onExport={exported} onOpenEditor={editor} />);
    await settle();
    expect(screen.lastFrame()).toMatchSnapshot();
    screen.stdin.write('v'); await settle();
    expect(editor).toHaveBeenCalledOnce();
    screen.stdin.write('['); await settle();
    expect(exported).toHaveBeenCalledOnce();
    expect(screen.lastFrame()).toBe('');
    screen.stdin.write('q'); await settle();
    expect(close).toHaveBeenCalledOnce();
    screen.unmount();
    await settle();
    expect(restore).toHaveBeenCalledOnce();
  });
});
