import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ShortcutsHelp } from '../src/ui/ShortcutsHelp.js';
import { InputBox } from '../src/ui/InputBox.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import { renderToString } from '../src/ui/renderToString.js';

const wrap = (child: React.ReactNode) => <ThemeProvider theme={loadTheme('dark')}>{child}</ThemeProvider>;

describe('shortcut help (?)', () => {
  it('uses Claude Code 2.1.281 column positions at 100 columns', () => {
    const lines = renderToString(wrap(<ShortcutsHelp />), 100).replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((line) => line.trimEnd());
    expect(lines[0]).toBe('  ! for shell mode        double tap esc to clear input      ctrl + shift + _ to undo');
    expect(lines[1]).toBe('  / for commands          shift + tab to auto-accept edits   ctrl + z to suspend');
    expect(lines[4]).toBe('                          \\⏎ for newline                     ctrl + s to stash prompt');
    expect(lines[5]).toBe('                                                             ctrl + g to edit in $EDITOR');
  });

  it('keeps three columns and wraps on narrow terminals', () => {
    const lines = renderToString(wrap(<ShortcutsHelp />), 60).replace(/\x1b\[[0-9;]*m/g, '').split('\n');
    expect(lines[0]).toMatch(/^  ! for shell mode\s*double tap esc to/);
    expect(lines.every((line) => line.trimEnd().length <= 60)).toBe(true);
  });

  it('closes with Esc and opens the model picker with alt+p', async () => {
    const onToggleHelp = vi.fn();
    const onSwitchModel = vi.fn();
    const screen = render(wrap(
      <InputBox isActive busy={false} queue={[]} history={[]} cwd={process.cwd()} commands={[]} showHelp
        onSubmit={() => {}} onCommand={() => {}} onBash={() => {}} onInterrupt={() => {}} onExit={() => {}} onCycleMode={() => {}}
        onClearScreen={() => {}} onToggleVerbose={() => {}} onToggleHelp={onToggleHelp} onDoubleEscape={() => {}} onPopQueue={() => undefined}
        onSwitchModel={onSwitchModel} />,
    ));
    await new Promise((resolve) => setImmediate(resolve));
    screen.stdin.write('\x1b');
    await vi.waitFor(() => expect(onToggleHelp).toHaveBeenCalledOnce());
    screen.stdin.write('\x1bp');
    await vi.waitFor(() => expect(onSwitchModel).toHaveBeenCalledOnce());
    screen.unmount();
  });
});
