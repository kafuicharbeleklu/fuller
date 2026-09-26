import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { InputBox, compareCommands } from '../src/ui/InputBox.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import { usageScore } from '../src/session/commandUsage.js';

const commands = ['/compact', '/config', '/context', '/copy', '/cost'].map((name) => ({ name, description: `${name} description` }));

describe('slash menu order by usage (Claude Code: /co → /copy first)', () => {
  it('weights uses by recency', () => {
    const now = Date.now();
    expect(usageScore({ '/copy': { count: 4, last: now } }, '/copy', now)).toBe(4);
    expect(usageScore({ '/copy': { count: 4, last: now - 7 * 86_400_000 } }, '/copy', now)).toBeCloseTo(2);
    expect(usageScore({}, '/copy', now)).toBe(0);
  });

  it('ranks a typed prefix as Claude Code 2.1.283 does: exact, then shortest names first', () => {
    const names = ['/compact', '/config', '/color', '/copy', '/context', '/docs-copy'];
    expect([...names].sort((a, b) => compareCommands(a, b, '/co'))).toEqual(['/copy', '/color', '/config', '/compact', '/context', '/docs-copy']);
    expect([...names].sort((a, b) => compareCommands(a, b, '/config'))[0]).toBe('/config');
    // A bare "/" lists by usage, then alphabetically.
    expect([...names].sort((a, b) => compareCommands(a, b, '/'))).toEqual(['/color', '/compact', '/config', '/context', '/copy', '/docs-copy']);
    // Same length: the one used most comes first.
    expect(['/compact', '/context'].sort((a, b) => compareCommands(a, b, '/co', { '/context': { count: 3, last: Date.now() } }))).toEqual(['/context', '/compact']);
  });

  it('lists the commands used most first, then alphabetically', async () => {
    const now = Date.now();
    const screen = render(
      <ThemeProvider theme={loadTheme('dark')}>
        <InputBox
          isActive busy={false} queue={[]} history={[]} cwd={process.cwd()} commands={commands as any} showHelp={false} placeholder=""
          commandUsage={{ '/copy': { count: 5, last: now }, '/config': { count: 2, last: now } }}
          onSubmit={() => {}} onCommand={() => {}} onBash={() => {}} onInterrupt={() => {}}
          onExit={() => {}} onCycleMode={() => {}} onClearScreen={() => {}} onToggleVerbose={() => {}}
          onToggleHelp={() => {}} onDoubleEscape={() => {}} onPopQueue={() => undefined}
        />
      </ThemeProvider>
    );
    await new Promise((r) => setTimeout(r, 30));
    screen.stdin.write('/co');
    await new Promise((r) => setTimeout(r, 50));
    const frame = screen.lastFrame() || '';
    const order = ['/copy', '/config', '/compact', '/context'].map((name) => frame.indexOf(`${name} `));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    screen.unmount();
  });
});
