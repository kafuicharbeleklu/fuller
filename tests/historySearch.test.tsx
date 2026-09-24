import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { HistorySearch } from '../src/ui/HistorySearch.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';

describe('ctrl+r prompt search (Claude Code 2.1.281 layout)', () => {
  it('puts the age before each prompt, the selection at the bottom', () => {
    const now = Date.now();
    const times: Record<string, number> = { '/resume': now - 11 * 60_000, 'okay go': now - 16 * 60_000 };
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><HistorySearch query="" scope="all" matches={['/resume', 'okay go']} index={0} timeOf={(entry) => times[entry]} /></ThemeProvider>);
    const lines = (screen.lastFrame() || '').split('\n');
    const older = lines.findIndex((line) => line.includes('16m ago  okay go'));
    const selected = lines.findIndex((line) => line.includes('❯ 11m ago  /resume'));
    expect(older).toBeGreaterThan(0);
    expect(selected).toBeGreaterThan(older);
    screen.unmount();
  });
});
