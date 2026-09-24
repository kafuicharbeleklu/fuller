import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { InputBox } from '../src/ui/InputBox.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';

describe('input border', () => {
  it('draws horizontal rules above and below the prompt without side borders', () => {
    const screen = render(
      <ThemeProvider theme={loadTheme('dark')}>
        <InputBox
          isActive
          busy={false}
          queue={[]}
          history={[]}
          cwd={process.cwd()}
          commands={[]}
          showHelp={false}
          onSubmit={() => {}}
          onCommand={() => {}}
          onBash={() => {}}
          onInterrupt={() => {}}
          onExit={() => {}}
          onCycleMode={() => {}}
          onClearScreen={() => {}}
          onToggleVerbose={() => {}}
          onToggleHelp={() => {}}
          onDoubleEscape={() => {}}
          onPopQueue={() => undefined}
        />
      </ThemeProvider>
    );
    const frame = screen.lastFrame() || '';
    expect(frame).toMatchSnapshot();
    const rows = frame.split('\n');
    expect(rows[0]).toMatch(/^─+$/);
    expect(rows[1]).toMatch(/^❯/);
    expect(rows[1]).not.toMatch(/[│╭╮╰╯]/);
    expect(rows[2]).toMatch(/^─+$/);
    screen.unmount();
  });
});
