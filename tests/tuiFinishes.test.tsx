import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { notificationSequence, detectChannel } from '../src/ui/notify.js';
import { SpinnerLine } from '../src/ui/Spinner.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';

vi.mock('../src/ui/keybindings.js', async (original) => ({ ...await original<typeof import('../src/ui/keybindings.js')>(), currentKeybindings: () => ({}) }));

describe('notification channels (Claude Code preferredNotifChannel)', () => {
  it('picks the terminal\'s own desktop notification, and the bell elsewhere', () => {
    expect(detectChannel({ TERM_PROGRAM: 'iTerm.app' })).toBe('iterm2');
    expect(detectChannel({ TERM_PROGRAM: 'ghostty' })).toBe('ghostty');
    expect(detectChannel({ KITTY_WINDOW_ID: '1', TERM: 'xterm-kitty' })).toBe('kitty');
    expect(detectChannel({ TERM: 'xterm-256color', VTE_VERSION: '7800' })).toBe('terminal_bell');
  });

  it('writes the sequence of each channel, with control characters removed from the text', () => {
    expect(notificationSequence('iterm2', 'Fuller', 'done')).toBe('\x1b]9;Fuller: done\x07');
    expect(notificationSequence('ghostty', 'Fuller', 'needs\x07 you')).toBe('\x1b]777;notify;Fuller;needs  you\x07');
    expect(notificationSequence('kitty', 'Fuller', 'done')).toBe('\x1b]99;i=1:d=0;Fuller\x1b\\\x1b]99;i=1:d=1:p=body;done\x1b\\');
    expect(notificationSequence('terminal_bell', 'Fuller', 'done')).toBe('\x07');
    expect(notificationSequence('notifications_disabled', 'Fuller', 'done')).toBe('');
    expect(notificationSequence('auto', 'Fuller', 'done', { TERM_PROGRAM: 'ghostty' })).toContain('\x1b]777;notify;');
  });
});

describe('reduce motion', () => {
  it('shows the verb without the shimmer', async () => {
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><SpinnerLine status="thinking" startedAt={Date.now()} responseTokens={0} verbs={['Mulling']} frame="✻" reducedMotion /></ThemeProvider>);
    const first = screen.lastFrame();
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.lastFrame()).toBe(first);
    expect((first ?? '').replace(/\x1b\[[0-9;]*m/g, '')).toContain('✻ Mulling…');
    screen.unmount();
  });
});

describe('/color', () => {
  it('sets the prompt bar colour for the session, resets it, and names the choices on a typo', async () => {
    const { runCommand } = await import('../src/ui/commands.js');
    const set = vi.fn();
    const said: string[] = [];
    const ctx = { setPromptColor: set, addSystem: (t: string) => said.push(t) } as any;
    await runCommand('/color purple', ctx);
    expect(set).toHaveBeenLastCalledWith('#a878e0');
    await runCommand('/color default', ctx);
    expect(set).toHaveBeenLastCalledWith(null);
    await runCommand('/color teal', ctx);
    expect(set).toHaveBeenCalledTimes(2);
    expect(said.at(-1)).toContain('red, blue, green, yellow, purple, orange, pink, cyan');
  });
});
