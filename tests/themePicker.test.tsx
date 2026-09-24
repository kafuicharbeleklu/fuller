import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import { ThemePicker } from '../src/ui/ThemePicker.js';

const wrap = (child: React.ReactNode) => <ThemeProvider theme={loadTheme('dark')}>{child}</ThemeProvider>;
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('theme picker', () => {
  it('opens on the current theme with Claude Code labels and a diff preview', async () => {
    const screen = render(wrap(<ThemePicker syntaxHighlighting current="dark" onPreview={() => {}} onSelect={() => {}} onCancel={() => {}} />));
    const frame = screen.lastFrame() || '';
    expect(frame).toContain('Theme');
    expect(frame).toContain('Choose the text style that looks best with your terminal');
    expect(frame).toContain('1. Auto (match terminal)');
    expect(frame).toContain('❯ 2. Dark mode ✔');
    expect(frame).toContain('4. Dark mode (colorblind-friendly)');
    expect(frame).toContain('Enter to select · Esc to cancel');
    screen.unmount();
  });

  it('previews each highlighted theme live, then selects with Enter', async () => {
    const onPreview = vi.fn();
    const onSelect = vi.fn();
    const screen = render(wrap(<ThemePicker syntaxHighlighting current="dark" onPreview={onPreview} onSelect={onSelect} onCancel={() => {}} />));
    await tick();
    expect(onPreview).toHaveBeenLastCalledWith('dark', true);
    screen.stdin.write('\x1b[B');
    await vi.waitFor(() => expect(onPreview).toHaveBeenLastCalledWith('light', true));
    screen.stdin.write('\x1b[A');
    screen.stdin.write('\x1b[A');
    await vi.waitFor(() => expect(onPreview).toHaveBeenLastCalledWith('auto', true));
    screen.stdin.write('\r');
    expect(onSelect).toHaveBeenCalledWith('auto', true);
    screen.unmount();
  });

  it('selects by number and cancels with Esc', async () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const screen = render(wrap(<ThemePicker syntaxHighlighting current="auto" onPreview={() => {}} onSelect={onSelect} onCancel={onCancel} />));
    await tick();
    screen.stdin.write('3');
    expect(onSelect).toHaveBeenCalledWith('light', true);
    screen.stdin.write('\x1b');
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled());
    screen.unmount();
  });

  it('toggles syntax highlighting with ctrl+t, previews it and keeps it on Enter', async () => {
    const onPreview = vi.fn();
    const onSelect = vi.fn();
    const screen = render(wrap(<ThemePicker syntaxHighlighting current="dark" onPreview={onPreview} onSelect={onSelect} onCancel={() => {}} />));
    await tick();
    expect(screen.lastFrame()).toContain('Syntax highlighting enabled (ctrl+t to disable)');
    screen.stdin.write('\x14');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('Syntax highlighting disabled (ctrl+t to enable)'));
    expect(onPreview).toHaveBeenLastCalledWith('dark', false);
    screen.stdin.write('\x1b[B');
    await vi.waitFor(() => expect(onPreview).toHaveBeenLastCalledWith('light', false));
    screen.stdin.write('\r');
    expect(onSelect).toHaveBeenCalledWith('light', false);
    screen.unmount();
  });
});
