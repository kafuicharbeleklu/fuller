import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { RewindMenu } from '../src/ui/RewindMenu.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';

const tick = () => new Promise((r) => setTimeout(r, 30));

describe('/rewind (Claude Code 2.1.281 layout)', () => {
  it('lists prompts oldest first with "(current)" selected, then confirms a restore', async () => {
    const onAction = vi.fn();
    const checkpoints = [
      { id: 'c2', timestamp: Date.now() - 8_000, prompt: 'Second prompt', messageIndex: 2 },
      { id: 'c1', timestamp: Date.now() - 60_000, prompt: 'First prompt', messageIndex: 0 },
    ];
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><RewindMenu checkpoints={checkpoints} codeChanges={(id) => (id === 'c1' ? ['a.ts'] : [])} onAction={onAction} onCancel={() => {}} /></ThemeProvider>);
    await tick();
    const frame = screen.lastFrame() || '';
    expect(frame).toContain('Restore the code and/or conversation to the point before…');
    expect(frame).toContain('❯ (current)');
    // 24 rows leave room for one entry: older prompts are above.
    expect(frame).toContain('↑ 2 more above');
    screen.stdin.write('\x1b[A'); await tick();
    expect(screen.lastFrame()).toContain('Second prompt');
    expect(screen.lastFrame()).toContain('No code changes');
    expect(screen.lastFrame()).toContain('↓ 1 more below');
    screen.stdin.write('\x1b[A'); await tick();
    expect(screen.lastFrame()).toContain('First prompt');
    expect(screen.lastFrame()).toContain('1 file changed');
    screen.stdin.write('\x1b[B'); await tick();
    screen.stdin.write('\r'); await tick();
    expect(screen.lastFrame()).toContain('Confirm you want to restore to the point before you sent this message:');
    expect(screen.lastFrame()).toContain('│ Second prompt');
    expect(screen.lastFrame()).toContain('The conversation will be forked.');
    expect(screen.lastFrame()).toContain('4. Never mind');
    screen.stdin.write('\r'); await tick();
    expect(onAction).toHaveBeenCalledWith('c2', 'conversation');
    screen.unmount();
  });
});
