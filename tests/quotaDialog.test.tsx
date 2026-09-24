import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { QuotaDialog } from '../src/ui/QuotaDialog.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';

const tick = () => new Promise((r) => setTimeout(r, 30));
const usage = { model: 'gemini-3.6-flash', keys: 15, exhausted: 15, refused: 6, usedFraction: 1, resetsAt: Date.now() + 2 * 3600_000, overloaded: false };

describe('quota dialog (model spent on every key)', () => {
  it('shows one usage bar and offers to switch, always switch, or stop', async () => {
    const resolve = vi.fn();
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><QuotaDialog request={{ from: 'gemini-3.6-flash', to: 'gemini-3.8-flash', reason: 'quota', usage, resolve }} /></ThemeProvider>);
    await tick();
    const frame = screen.lastFrame() || '';
    expect(frame).toContain('Usage limit reached for Gemini 3.6 Flash');
    expect(frame).toMatch(/█{20} 100% used · resets in 1h 5\d?m|█{20} 100% used · resets in 2h 00m/);
    expect(frame).toContain('Continue this conversation with Gemini 3.8 Flash? The whole conversation is kept.');
    expect(frame).toContain('1. Switch to Gemini 3.8 Flash');
    expect(frame).toContain("2. Switch to Gemini 3.8 Flash, and don't ask again");
    expect(frame).toContain('3. Stop');
    expect(frame).not.toMatch(/key \d+\/\d+/);
    screen.stdin.write('\x1b[B'); await tick();
    screen.stdin.write('\r'); await tick();
    expect(resolve).toHaveBeenCalledWith('always');
    screen.unmount();
  });

  it('offers to keep trying an overloaded model, and Esc stops', async () => {
    const resolve = vi.fn();
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><QuotaDialog request={{ from: 'gemini-3.6-flash', to: undefined, reason: 'overloaded', usage: { ...usage, exhausted: 0, usedFraction: 0 }, resolve }} /></ThemeProvider>);
    await tick();
    expect(screen.lastFrame()).toContain('Gemini 3.6 Flash is overloaded (high demand)');
    expect(screen.lastFrame()).toContain('1. Keep trying');
    screen.stdin.write('\x1b'); await tick();
    expect(resolve).toHaveBeenCalledWith('stop');
    screen.unmount();
  });
});
