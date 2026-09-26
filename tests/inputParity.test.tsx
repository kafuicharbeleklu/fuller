import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { InputBox, type InputBoxProps } from '../src/ui/InputBox.js';
import { PermissionPrompt } from '../src/ui/PermissionPrompt.js';
import { nextWord, previousWord } from '../src/ui/textInput.js';
import type { PendingConfirmation } from '../src/agent/types.js';

// No user file: the prompt's built-in keys only (the loader has its own tests, tests/keybindings.test.ts).
vi.mock('../src/ui/keybindings.js', async (original) => ({ ...await original<typeof import('../src/ui/keybindings.js')>(), loadKeybindings: () => ({}), currentKeybindings: () => ({}) }));
afterEach(cleanup);
const settle = () => new Promise((resolve) => setTimeout(resolve, 35));
async function input(extra: Partial<InputBoxProps> = {}) {
  const submit = vi.fn();
  const command = vi.fn();
  const sendNow = vi.fn();
  const screen = render(<InputBox isActive busy={false} queue={[]} history={[]} cwd='/tmp' commands={[]} showHelp={false}
    onSubmit={submit} onCommand={command} onBash={() => {}} onSendNow={sendNow}
    onInterrupt={() => {}} onExit={() => {}} onCycleMode={() => {}} onClearScreen={() => {}} onToggleVerbose={() => {}}
    onToggleHelp={() => {}} onDoubleEscape={() => {}} onPopQueue={() => undefined} {...extra} />);
  await settle();
  const keys = async (...events: string[]) => { for (const event of events) { screen.stdin.write(event); await settle(); } };
  return { ...screen, keys, submit, command, sendNow };
}
const content = 'line1\nline2\nline3\nline4';
const paste = `\x1b[200~${content}\x1b[201~`;

describe('prompt parity', () => {
  it('restores pasted content from history and undo without sending the marker', async () => {
    const screen = await input();
    await screen.keys(paste, '\r', '\x1b[A', '\r');
    expect(screen.submit.mock.calls.map(([text]) => text)).toEqual([content, content]);
    await screen.keys(paste, '\x7f', '\x1f', '\r');
    expect(screen.submit).toHaveBeenLastCalledWith(content, []);
  });

  it('expands a paste when running a shell command and blocks missing references', async () => {
    const bash = vi.fn();
    const screen = await input({ onBash: bash });
    await screen.keys('!', paste, '\r');
    expect(bash).toHaveBeenCalledWith(content);
    await screen.keys('[Pasted text #99 +4 lines]', '\r');
    expect(screen.submit).not.toHaveBeenCalled();
    expect(screen.lastFrame()).toContain('Pasted content is unavailable');
  });

  it('uses punctuation boundaries for Alt+B and whitespace boundaries for Ctrl+W', async () => {
    const screen = await input();
    await screen.keys('src/utils/foo.ts', '\x1bb', 'X', '\r');
    expect(screen.submit).toHaveBeenLastCalledWith('src/utils/foo.Xts', []);
    await screen.keys('keep alpha:beta', '\x17', '\r');
    expect(screen.submit).toHaveBeenLastCalledWith('keep', []);
    expect(previousWord('foo_bar', 7)).toBe(4);
    expect(nextWord('foo_bar', 0)).toBe(3);
    expect(previousWord('你好世界', 4)).toBeGreaterThan(0);
  });

  it('sends immediately with Ctrl+Enter and the portable chord while preserving Ctrl+J', async () => {
    const screen = await input({ busy: true, queue: ['queued'] });
    await screen.keys('draft', '\x1b[13;5u');
    expect(screen.sendNow).toHaveBeenLastCalledWith('draft', []);
    await screen.keys('one', '\n', 'two', '\r');
    expect(screen.submit).toHaveBeenLastCalledWith('one\ntwo', []);
    await screen.keys('next', '\x18\x13');
    expect(screen.sendNow).toHaveBeenLastCalledWith('next', []);
    await screen.keys('\x1b[13;5u');
    expect(screen.sendNow).toHaveBeenLastCalledWith('', []);
  });

  it('cycles the /diff panel base with Ctrl+X B, and keeps a plain b as text', async () => {
    const onCycleDiffBase = vi.fn();
    const screen = await input({ onCycleDiffBase });
    await screen.keys('\x18', 'b');
    expect(onCycleDiffBase).toHaveBeenCalledTimes(1);
    expect(screen.lastFrame()).not.toMatch(/❯ b/);
    await screen.keys('b');
    expect(onCycleDiffBase).toHaveBeenCalledTimes(1);
    expect(screen.lastFrame()).toContain('b');
  });

  it('puts an injected token in the draft once, lets Backspace delete it, and reports mouse releases', async () => {
    const onMouseRelease = vi.fn();
    const screen = await input({ onMouseRelease, injected: { id: 1, text: '[3 lines selected] ' } });
    await settle();
    expect(screen.lastFrame()).toContain('[3 lines selected]');
    await screen.keys('why?', '\x7f\x7f\x7f\x7f');
    await screen.keys('\x7f');
    expect(screen.lastFrame()).toContain('[3 lines selected]');
    expect(screen.lastFrame()).not.toContain('[3 lines selected] ');
    await screen.keys('\x1b[<0;12;7m');
    expect(onMouseRelease).toHaveBeenCalledWith(12, 7);
  });

  it('exits with Ctrl+D only on a second press within 800 ms, and says so (report of 25/09)', async () => {
    const onExit = vi.fn();
    const onStateChange = vi.fn();
    const screen = await input({ onExit, onStateChange });
    await screen.keys('\x04');
    expect(onExit).not.toHaveBeenCalled();
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ hint: 'Press Ctrl-D again to exit' }));
    await screen.keys('\x04');
    expect(onExit).toHaveBeenCalledTimes(1);
    // Too slow: the first press expires.
    await screen.keys('\x04');
    await new Promise((r) => setTimeout(r, 900));
    await screen.keys('\x04');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft in the history when Esc Esc clears it', async () => {
    const screen = await input();
    await screen.keys('a draft worth keeping', '\x1b');
    await new Promise((r) => setTimeout(r, 50));
    await screen.keys('\x1b');
    expect(screen.lastFrame()).not.toContain('a draft worth keeping');
    await screen.keys('\x1b[A');
    expect(screen.lastFrame()).toContain('a draft worth keeping');
  });

  it('stashes a ! command with its mode and brings it back as a shell command', async () => {
    const onStateChange = vi.fn();
    const screen = await input({ onStateChange });
    await screen.keys('!', 'ls -la');
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ bashMode: true }));
    await screen.keys('\x13');
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ bashMode: false, empty: true, stashed: true }));
    await screen.keys('\x13');
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ bashMode: true, empty: false }));
    expect(screen.lastFrame()).toContain('ls -la');
  });

  it('handles the Ctrl+X chords: Ctrl+B backgrounds, Ctrl+K twice stops agents, and the chord expires after 3 s', async () => {
    const onBackground = vi.fn(() => true);
    const onStopAgents = vi.fn(() => 2);
    const onCycleDiffBase = vi.fn();
    const screen = await input({ onBackground, onStopAgents, onCycleDiffBase });
    await screen.keys('\x18', '\x02');
    expect(onBackground).toHaveBeenCalledTimes(1);
    await screen.keys('\x18', '\x0b');
    expect(onStopAgents).not.toHaveBeenCalled();
    await screen.keys('\x18', '\x0b');
    expect(onStopAgents).toHaveBeenCalledTimes(1);
    // A chord left open for more than 3 s is dropped: the next b is plain text.
    await screen.keys('\x18');
    await new Promise((r) => setTimeout(r, 3100));
    await screen.keys('b');
    expect(onCycleDiffBase).not.toHaveBeenCalled();
    expect(screen.lastFrame()).toContain('b');
  }, 10_000);

  it('/tasks opens a task with Enter and stops it with x', async () => {
    const { ListDialog } = await import('../src/ui/InfoDialogs.js');
    const { ThemeProvider, loadTheme } = await import('../src/ui/theme.js');
    const opened = vi.fn();
    const stopped = vi.fn();
    const close = vi.fn();
    const items = [{ label: 'bg1 · running · 3s · npm run dev', onSelect: opened, onShortcut: stopped }, { label: 'bg2 · completed', onSelect: vi.fn() }];
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><ListDialog title="Background" items={items} shortcutKey="x" onClose={close} /></ThemeProvider>);
    await settle();
    screen.stdin.write('x'); await settle();
    expect(stopped).toHaveBeenCalledTimes(1);
    screen.stdin.write('\r'); await settle();
    expect(opened).toHaveBeenCalledTimes(1);
    screen.unmount();
  });

  it('cycles older kills with Alt+Y after Ctrl+Y (yank-pop)', async () => {
    const screen = await input();
    await screen.keys('first', '\x15', 'second', '\x15');
    await screen.keys('\x19');
    expect(screen.lastFrame()).toContain('second');
    await screen.keys('\x1by');
    expect(screen.lastFrame()).toContain('first');
    expect(screen.lastFrame()).not.toContain('second');
    await screen.keys('\x1by');
    expect(screen.lastFrame()).toContain('second');
    await screen.keys('\r');
    expect(screen.submit).toHaveBeenLastCalledWith('second', []);
  });

  it('shell mode: a pasted ! command enters it, Ctrl+U on an empty field leaves it, Tab completes from ! history', async () => {
    const onStateChange = vi.fn();
    const screen = await input({ onStateChange, history: ['!npm run build', 'hello', '!npm test'] });
    await screen.keys('\x1b[200~!ls -la\x1b[201~');
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ bashMode: true }));
    expect(screen.lastFrame()).toContain('ls -la');
    await screen.keys('\x15');
    await screen.keys('\x15');
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ bashMode: false }));
    await screen.keys('!', 'npm', '\t');
    expect(screen.lastFrame()).toContain('npm test');
    await screen.keys('\x17', '\x17', 'npm run', '\t');
    expect(screen.lastFrame()).toContain('npm run build');
  });

  it('takes the queue ahead of a draft on its first line', async () => {
    const take = vi.fn(() => ({ text: 'one\ntwo', attachments: [], bash: false }));
    const screen = await input({ queue: ['one', 'two'], onTakeQueue: take });
    await screen.keys('draft', '\x1b[A', '\r');
    expect(take).toHaveBeenCalledWith(false);
    expect(screen.submit).toHaveBeenLastCalledWith('one\ntwo\ndraft', []);
  });

  it('loads a fullscreen history result without submitting and restores the draft on Escape', async () => {
    const screen = await input({ fullscreen: true, history: ['project prompt'], sessionHistory: ['session prompt'], allHistory: ['other prompt'] });
    await screen.keys('draft', '\x12');
    // Claude Code 2.1.281: "Search prompts · everywhere", then ctrl+s cycles the scope.
    expect(screen.lastFrame()).toContain('Search prompts · everywhere');
    expect(screen.lastFrame()).toContain('↑/↓ to nav · Enter to use · Esc to cancel · ctrl+s to scope');
    await screen.keys('\x13');
    expect(screen.lastFrame()).toContain('Search prompts · session');
    await screen.keys('\x13', 'project');
    expect(screen.lastFrame()).toMatchSnapshot();
    await screen.keys('\r');
    expect(screen.submit).not.toHaveBeenCalled();
    await screen.keys('\r');
    expect(screen.submit).toHaveBeenLastCalledWith('project prompt', []);
    await screen.keys('draft', '\x12', '\x1b', '\r');
    expect(screen.submit).toHaveBeenLastCalledWith('draft', []);
  });

  it('keeps classic Enter submission and cancels an empty search with Backspace', async () => {
    const screen = await input({ history: ['old prompt'] });
    await screen.keys('\x12', 'old', '\r');
    expect(screen.submit).toHaveBeenCalledWith('old prompt', []);
    await screen.keys('draft', '\x12', '\x7f', '\r');
    expect(screen.submit).toHaveBeenLastCalledWith('draft', []);
  });

  it.each(['\t', '\x1b[C'])('accepts a next-prompt suggestion with %j', async (key) => {
    const screen = await input({ placeholder: 'Try "fix the failing test"' });
    await screen.keys(key, '\r');
    expect(screen.submit).toHaveBeenCalledWith('fix the failing test', []);
  });

  it('routes wheel, page and endpoint keys separately from editing', async () => {
    const scroll = vi.fn();
    const background = vi.fn(() => true);
    const screen = await input({ fullscreen: true, onScrollTranscript: scroll, onBackground: background });
    await screen.keys('\x1b[<64;4;4M', '\x1b[5~', '\x1b[1;5H', '\x1b[1;5F', '\x02');
    expect(scroll.mock.calls.map(([action]) => action)).toEqual(['lineUp', 'up', 'top', 'bottom']);
    expect(background).toHaveBeenCalledOnce();
  });

  const commands = [{ name: '/compact', description: 'Compact', run: () => {} }, { name: '/context', description: 'Context', run: () => {} }];
  it('completes slash commands mid-prompt without executing them', async () => {
    const screen = await input({ fullscreen: true, commands });
    await screen.keys('then /com');
    expect(screen.lastFrame()).toMatchSnapshot();
    await screen.keys('\t', 'please', '\r');
    expect(screen.submit).toHaveBeenCalledWith('then /compact please', []);
    expect(screen.command).not.toHaveBeenCalled();
  });

  it('sends unselected mid-prompt text on Enter and selects a row only after navigation', async () => {
    const screen = await input({ fullscreen: true, commands });
    await screen.keys('then /co', '\r');
    expect(screen.submit).toHaveBeenLastCalledWith('then /co', []);
    await screen.keys('then /co', '\x1b[B', '\r', '\r');
    expect(screen.submit).toHaveBeenLastCalledWith('then /compact', []);
    expect(screen.command).not.toHaveBeenCalled();
  });

  it('opens multiple classic matches with Tab before inserting a command', async () => {
    const screen = await input({ commands });
    await screen.keys('then /co');
    expect(screen.lastFrame()).toMatchSnapshot();
    await screen.keys('\t', '\x1b[B', '\r', '\r');
    expect(screen.submit).toHaveBeenLastCalledWith('then /compact', []);
  });
});

async function permission(name = 'execute_bash') {
  const decide = vi.fn();
  const confirmation: PendingConfirmation = { toolCall: { id: 't', name, args: {}, status: 'confirming' }, title: 'Allow this action?', options: [
    { value: 'yes', label: 'Yes' }, { value: 'always', label: 'Always', rule: 'Bash(echo *)' }, { value: 'no', label: 'No' },
  ], onDecide: decide };
  const screen = render(<PermissionPrompt confirmation={confirmation} verbose={false} />);
  await settle();
  return { ...screen, decide, keys: async (...events: string[]) => { for (const event of events) { screen.stdin.write(event); await settle(); } } };
}

describe('permission parity', () => {
  it('requires an explicit selection instead of accepting a bare y or n', async () => {
    const screen = await permission();
    await screen.keys('y', 'n');
    expect(screen.decide).not.toHaveBeenCalled();
    await screen.keys('\r');
    expect(screen.decide).toHaveBeenCalledExactlyOnceWith({ kind: 'yes' });
  });

  it('denies immediately without an extra confirmation', async () => {
    const screen = await permission();
    await screen.keys('3');
    expect(screen.decide).toHaveBeenCalledExactlyOnceWith({ kind: 'no' });
  });

  it('amends Yes and No inline like Claude Code', async () => {
    const screen = await permission();
    expect(screen.lastFrame()).toContain('Esc to cancel · Tab to amend');
    await screen.keys('\t');
    expect(screen.lastFrame()).toContain('❯ 1. Yes, and tell Fuller what to do next');
    expect(screen.lastFrame()).not.toContain('Tab to amend');
    await screen.keys('\x1b[B', '\x1b[B', '\t');
    expect(screen.lastFrame()).toContain('❯ 3. No, and tell Fuller what to do differently');
  });

  it('retains comments on Yes and No when closing the field', async () => {
    const screen = await permission();
    await screen.keys('\t', 'run once', '\t', '\x1b[B', '\x1b[B', '\t', 'use tests', '\t', '\x1b[A', '\x1b[A', '\t');
    expect(screen.lastFrame()).toMatchSnapshot();
    await screen.keys('\r');
    expect(screen.decide).toHaveBeenCalledExactlyOnceWith({ kind: 'yes', feedback: 'run once' });
  });

  it('submits denial feedback and closes a file comment with Shift+Tab without approving', async () => {
    const screen = await permission('write_file');
    await screen.keys('\x1b[B', '\x1b[B', '\t', 'add tests', '\x1b[Z');
    expect(screen.decide).not.toHaveBeenCalled();
    await screen.keys('\r');
    expect(screen.decide).toHaveBeenCalledWith({ kind: 'no', feedback: 'add tests' });
  });

  it('does not offer a comment for persistent rules or web fetch', async () => {
    const screen = await permission('web_fetch');
    await screen.keys('\t');
    expect(screen.lastFrame()).not.toContain('comment');
    await screen.keys('\x1b[B', '\t', '\r');
    expect(screen.decide).toHaveBeenCalledWith({ kind: 'always', rule: 'Bash(echo *)' });
  });
});

describe('input parity with Claude Code 2.1.281', () => {
  const box = async (props: Record<string, unknown> = {}) => {
    const { InputBox } = await import('../src/ui/InputBox.js');
    const { ThemeProvider, loadTheme } = await import('../src/ui/theme.js');
    const states: Array<{ hint?: string }> = [];
    const onExit = vi.fn();
    const screen = render(
      <ThemeProvider theme={loadTheme('dark')}>
        <InputBox isActive busy={false} queue={[]} history={[]} cwd={process.cwd()} commands={[]} showHelp={false}
          onSubmit={() => {}} onCommand={() => {}} onBash={() => {}} onInterrupt={() => {}} onExit={onExit} onCycleMode={() => {}}
          onClearScreen={() => {}} onToggleVerbose={() => {}} onToggleHelp={() => {}} onDoubleEscape={() => {}} onPopQueue={() => undefined}
          onStateChange={(s) => states.push(s)} {...props} />
      </ThemeProvider>
    );
    const keys = async (...sequences: string[]) => { for (const s of sequences) { screen.stdin.write(s); await new Promise((r) => setTimeout(r, 20)); } };
    await new Promise((r) => setImmediate(r));
    return { screen, keys, states, onExit };
  };
  const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;
  const twenty = Array.from({ length: 20 }, (_, i) => `pasted line ${i + 1}`).join('\n');

  it('shows a dimmed example after ❯, also in shell mode', async () => {
    const { screen, keys } = await box({ placeholder: 'Try "fix lint errors"' });
    expect(screen.lastFrame()!.split('\n')[1].trimEnd()).toBe('❯ Try "fix lint errors"');
    await keys('!');
    expect(screen.lastFrame()!.split('\n')[1].trimEnd()).toBe('! Try "fix lint errors"');
    screen.unmount();
  });

  it('counts pasted line breaks and expands the placeholder when the same text is pasted again', async () => {
    const { screen, keys, states } = await box();
    await keys(paste(twenty));
    expect(screen.lastFrame()).toContain('❯ [Pasted text #1 +19 lines]');
    expect(states.at(-1)?.hint).toBe('paste again to expand');
    await keys(paste(twenty));
    expect(screen.lastFrame()).toContain('pasted line 20');
    expect(screen.lastFrame()).not.toContain('[Pasted text');
    expect(states.at(-1)?.hint).toBeUndefined();
    screen.unmount();
  });

  it('clears the input and arms the exit with the same ctrl+c', async () => {
    const { screen, keys, states, onExit } = await box();
    await keys('hello', '\x03');
    expect(screen.lastFrame()).not.toContain('hello');
    expect(states.at(-1)?.hint).toBe('Press Ctrl-C again to exit');
    await keys('\x03');
    expect(onExit).toHaveBeenCalledOnce();
    screen.unmount();
  });
});

describe('input hints for the line above the prompt', () => {
  it('reports multiline text and deleted text that can be yanked back', async () => {
    const { InputBox } = await import('../src/ui/InputBox.js');
    const { ThemeProvider, loadTheme } = await import('../src/ui/theme.js');
    const states: Array<{ multiline?: boolean; killed?: boolean }> = [];
    const screen = render(
      <ThemeProvider theme={loadTheme('dark')}>
        <InputBox isActive busy={false} queue={[]} history={[]} cwd={process.cwd()} commands={[]} showHelp={false}
          onSubmit={() => {}} onCommand={() => {}} onBash={() => {}} onInterrupt={() => {}} onExit={() => {}} onCycleMode={() => {}}
          onClearScreen={() => {}} onToggleVerbose={() => {}} onToggleHelp={() => {}} onDoubleEscape={() => {}} onPopQueue={() => undefined}
          onStateChange={(s) => states.push(s)} />
      </ThemeProvider>
    );
    const keys = async (...sequences: string[]) => { for (const s of sequences) { screen.stdin.write(s); await new Promise((r) => setTimeout(r, 20)); } await new Promise((r) => setTimeout(r, 50)); };
    await new Promise((r) => setImmediate(r));
    await keys('one', '\\\r', 'two');
    expect(screen.lastFrame()).toContain('one');
    expect(states.at(-1)?.multiline).toBe(true);
    await keys('\x15');
    expect(states.at(-1)?.killed).toBe(true);
    await keys('\x19');
    expect(states.at(-1)?.killed).toBe(false);
    await keys('\x15', '\x15', '\x0b');
    screen.unmount();
  });
});

describe('input state reporting (regression)', () => {
  it('still reports the input state after Tab completion and ctrl+u', async () => {
    const { InputBox } = await import('../src/ui/InputBox.js');
    const { ThemeProvider, loadTheme } = await import('../src/ui/theme.js');
    const { COMMANDS } = await import('../src/ui/commands.js');
    const states: Array<{ empty: boolean; menuOpen: boolean }> = [];
    const screen = render(
      <ThemeProvider theme={loadTheme('dark')}>
        <InputBox isActive busy={false} queue={[]} history={[]} cwd={process.cwd()} commands={COMMANDS} showHelp={false}
          onSubmit={() => {}} onCommand={() => {}} onBash={() => {}} onInterrupt={() => {}} onExit={() => {}} onCycleMode={() => {}}
          onClearScreen={() => {}} onToggleVerbose={() => {}} onToggleHelp={() => {}} onDoubleEscape={() => {}} onPopQueue={() => undefined}
          onStateChange={(s) => states.push(s)} />
      </ThemeProvider>
    );
    await new Promise((r) => setImmediate(r));
    for (const key of ['/', 'co', '\t', '\x15']) { screen.stdin.write(key); await new Promise((r) => setTimeout(r, 60)); }
    expect(states.at(-1)?.empty).toBe(true);
    screen.stdin.write('@');
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ empty: false, menuOpen: true }));
    screen.unmount();
  });
});

describe('ctrl+s stash and ctrl+z', () => {
  it('stashes a prompt, restores it on an empty prompt, and hands ctrl+z to onSuspend', async () => {
    const { InputBox } = await import('../src/ui/InputBox.js');
    const { ThemeProvider, loadTheme } = await import('../src/ui/theme.js');
    const states: Array<{ stashed?: boolean }> = [];
    const onSuspend = vi.fn();
    const screen = render(
      <ThemeProvider theme={loadTheme('dark')}>
        <InputBox isActive busy={false} queue={[]} history={[]} cwd={process.cwd()} commands={[]} showHelp={false}
          onSubmit={() => {}} onCommand={() => {}} onBash={() => {}} onInterrupt={() => {}} onExit={() => {}} onCycleMode={() => {}}
          onClearScreen={() => {}} onToggleVerbose={() => {}} onToggleHelp={() => {}} onDoubleEscape={() => {}} onPopQueue={() => undefined}
          onStateChange={(s) => states.push(s)} onSuspend={onSuspend} />
      </ThemeProvider>
    );
    const keys = async (...sequences: string[]) => { for (const s of sequences) { screen.stdin.write(s); await new Promise((r) => setTimeout(r, 30)); } };
    await new Promise((r) => setImmediate(r));
    await keys('draft one', '\x13');
    expect(screen.lastFrame()).not.toContain('draft one');
    expect(states.at(-1)?.stashed).toBe(true);
    await keys('\x13');
    expect(screen.lastFrame()).toContain('draft one');
    expect(states.at(-1)?.stashed).toBe(false);
    await keys('\x1a');
    expect(onSuspend).toHaveBeenCalledOnce();
    expect(screen.lastFrame()).toContain('draft one');
    screen.unmount();
  });
});

describe('Ctrl+Y tip after Ctrl+U (Claude Code 2.1.283, read in its binary)', () => {
  it('says "Ctrl+Y to paste deleted text" for 5 s after Ctrl+U deleted 3 characters or more, even once the input is empty', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const states: Array<{ killed?: boolean; empty: boolean }> = [];
      const screen = await input({ onStateChange: (s: any) => states.push(s) });
      await screen.keys('hi', '\x15');
      expect(states.at(-1)).toMatchObject({ empty: true });
      expect(states.at(-1)?.killed).toBeFalsy();
      await screen.keys('hello', '\x15');
      await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ empty: true, killed: true }));
      vi.advanceTimersByTime(5100);
      await vi.waitFor(() => expect(states.at(-1)?.killed).toBe(false));
    } finally {
      vi.useRealTimers();
    }
  });
});
