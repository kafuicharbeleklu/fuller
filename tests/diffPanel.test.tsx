import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { DiffPanel, diffPanelHits } from '../src/ui/DiffPanel.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';

const plain = (frame: string) => frame.split('\n').map((line) => line.replace(/\x1b\[[0-9;]*m/g, ''));
const diff = 'diff --git a/demo.txt b/demo.txt\n--- a/demo.txt\n+++ b/demo.txt\n@@ -1,2 +1,4 @@\n line one\n-line two\n+line 2 changed\n+line three\n+four\n';
const panel = (files: any[], showOthers = false) => render(
  <ThemeProvider theme={loadTheme('dark')}>
    <DiffPanel files={files} others={[{ file: 'old.txt', diff: '', additions: 1, removals: 0 }]} showOthers={showOthers} width={57} height={16} />
  </ThemeProvider>,
);

describe('/diff panel (Claude Code 2.1.281, 110 columns and more)', () => {
  it('says there are no changes this session, centred, with the earlier edits at the bottom', () => {
    const screen = panel([]);
    const rows = plain(screen.lastFrame() || '');
    expect(rows[1].trimEnd().endsWith('✕')).toBe(true);
    expect(rows[8].trim()).toBe('No changes this session');
    expect(rows[14].trim()).toBe('+1 file edited before this session (show)');
    screen.unmount();
  });

  it('lists the session files, then each diff under its name', () => {
    const screen = panel([{ file: 'demo.txt', diff, additions: 3, removals: 1 }]);
    const rows = plain(screen.lastFrame() || '');
    expect(rows[1]).toMatch(/^ 1 file changed \+3 -1 +✕/);
    expect(rows[3]).toMatch(/^ demo\.txt +\+3 -1/);
    expect(rows[5].trim()).toBe('demo.txt');
    expect(rows[7]).toContain(' 1  line one');
    expect(rows[8]).toContain(' 2 -line two');
    expect(rows[11]).toContain(' 4 +four');
    screen.unmount();
  });

  it('places the ✕ and the (show) link where clicks are expected', () => {
    expect(diffPanelHits(16, 57)).toEqual({ closeRow: 1, closeCol: 56, showRow: 14 });
  });
});
