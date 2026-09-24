import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { AgentsView, shortAge } from '../src/ui/AgentsView.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';

const tick = () => new Promise((r) => setTimeout(r, 30));

describe('agents view (← on an empty prompt)', () => {
  it('lists the conversation and the agents, starts, opens and deletes agents', async () => {
    const onStart = vi.fn();
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    const onClose = vi.fn();
    const now = 1_000_000;
    const tasks = [
      { id: 'a1', title: 'check the build', status: 'working' as const, startedAt: now - 5_000, progress: 'Bash(npm run build)' },
      { id: 'b2', title: 'reply pong', status: 'completed' as const, startedAt: now - 800_000, endedAt: now - 720_000, report: 'pong' },
    ];
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><AgentsView tasks={tasks} model="gemini-3.6-flash" workspaceDir="/tmp/demo" mode="default" lastActivity={now} frame="✻" now={now} onClose={onClose} onStart={onStart} onOpen={onOpen} onDelete={onDelete} /></ThemeProvider>);
    await tick();
    const frame = screen.lastFrame() || '';
    expect(frame).toContain('1 awaiting input · 1 working · 1 completed');
    expect(frame).toContain('Your conversation moved to the background');
    expect(frame).toMatch(/✻ current session +demo +0s/);
    expect(frame).toMatch(/check the build +Bash\(npm run build\) +5s/);
    expect(frame).toMatch(/∙ reply pong +pong +12m/);
    expect(frame).toContain('❯ describe a task for a new session');
    screen.stdin.write('\x1b[B'); await tick();
    screen.stdin.write('\x1b[B'); await tick();
    screen.stdin.write('\r'); await tick();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'b2' }));
    screen.stdin.write('\x18'); await tick();
    expect(onDelete).toHaveBeenCalledWith('b2');
    screen.stdin.write('lint'); await tick();
    expect(screen.lastFrame()).toContain('enter to start');
    screen.stdin.write('\r'); await tick();
    expect(onStart).toHaveBeenCalledWith('lint');
    screen.stdin.write('\x1b'); await tick();
    expect(onClose).toHaveBeenCalled();
    screen.unmount();
  });

  it('writes short ages', () => {
    expect(shortAge(0)).toBe('0s');
    expect(shortAge(12 * 60_000)).toBe('12m');
    expect(shortAge(3 * 3_600_000)).toBe('3h');
  });
});
