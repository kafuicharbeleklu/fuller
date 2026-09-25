import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { DiffPanel, diffPanelClick, panelRows, panelSelection } from '../src/ui/DiffPanel.js';
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
    const state = { files: [], others: [{ file: 'old.txt', diff: '', additions: 1, removals: 0 }], showOthers: false };
    expect(diffPanelClick(state, 57, 16, 1, 56)).toEqual({ close: true });
    expect(diffPanelClick(state, 57, 16, 14, 3)).toEqual({ toggle: true });
    expect(diffPanelClick(state, 57, 16, 8, 3)).toBeNull();
  });

  it('scrolls its body and jumps to a file\'s diff when its row is clicked', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ file: `f${i}.txt`, diff, additions: 3, removals: 1 }));
    const state = { files: many, others: [], showOthers: false };
    const { rows } = panelRows(state, 57);
    const target = (rows[1 + 5] as any).target;
    expect(rows[target + 1]).toMatchObject({ kind: 'title', text: 'f5.txt' });
    // Row 2 of the panel is the first body row (a blank); the list starts on row 3.
    const jump = diffPanelClick(state, 57, 16, 3 + 5, 3);
    expect(jump).toEqual({ scroll: Math.min(target, rows.length - 12) });
    const screen = render(
      <ThemeProvider theme={loadTheme('dark')}>
        <DiffPanel {...state} scroll={target} width={57} height={16} />
      </ThemeProvider>,
    );
    const shown = plain(screen.lastFrame() || '');
    expect(shown.some((l) => l.trim() === 'f5.txt')).toBe(true);
    expect(shown.some((l) => /^ f0\.txt +\+3 -1/.test(l))).toBe(false);
    expect(shown[1]).toMatch(/6 files changed/);
    screen.unmount();
  });

  it('shows the earlier changes like Claude Code 2.1.282: (hide) under "No changes this session", untracked files without counts', () => {
    const others = [
      { file: '.env.example', diff: '', additions: 1, removals: 0, untracked: true },
      { file: 'a.txt', diff, additions: 3, removals: 1 },
    ];
    const screen = render(
      <ThemeProvider theme={loadTheme('dark')}>
        <DiffPanel files={[]} others={others} showOthers width={57} height={30} />
      </ThemeProvider>,
    );
    const rows = plain(screen.lastFrame() || '');
    expect(rows[1].trimEnd().endsWith('✕')).toBe(true);
    expect(rows[1]).not.toMatch(/files? changed/);
    expect(rows[3].trim()).toBe('No changes this session');
    expect(rows[5].trim()).toBe('+2 files edited before this session (hide)');
    expect(rows[7].trim()).toBe('.env.example');
    expect(rows[8]).toMatch(/^ a\.txt +\+3 -1/);
    expect(rows[10].trim()).toBe('.env.example (untracked)');
    expect(rows[12].trim()).toBe('New file not yet staged.');
    expect(rows[13].trim()).toBe('Run `git add :/.env.example` to see line counts.');
    expect(rows[15].trim()).toBe('a.txt');
    expect(rows.slice(26).join('\n')).not.toContain('(hide)');
    expect(diffPanelClick({ files: [], others, showOthers: true }, 57, 30, 5, 3)).toEqual({ toggle: true });
    screen.unmount();
  });

  it('counts only this session\'s files in the header', () => {
    const screen = render(
      <ThemeProvider theme={loadTheme('dark')}>
        <DiffPanel files={[{ file: 'demo.txt', diff, additions: 3, removals: 1 }]} others={[{ file: 'old.txt', diff: '', additions: 9, removals: 9 }]} showOthers width={57} height={40} />
      </ThemeProvider>,
    );
    expect(plain(screen.lastFrame() || '')[1]).toMatch(/^ 1 file changed \+3 -1 +✕/);
    screen.unmount();
  });
  it('leaves test and generated files out of the list, behind a count line that a click expands (Claude Code docs)', () => {
    const skipped = [{ file: 'tests/a.test.ts', diff, additions: 3, removals: 1 }, { file: 'package-lock.json', diff, additions: 3, removals: 1 }];
    const state = { files: [{ file: 'src/a.ts', diff, additions: 3, removals: 1 }], others: [], showOthers: false, skipped, showSkipped: false };
    const { rows } = panelRows(state, 57);
    const line = rows.findIndex((r) => r.kind === 'skipped');
    expect((rows[line] as any).text).toBe('+2 test and generated files (show)');
    expect(rows.some((r) => r.kind === 'title' && r.text === 'tests/a.test.ts')).toBe(false);
    // The count line is a body row: clicking it toggles the group.
    expect(diffPanelClick(state, 57, 40, 2 + line, 3)).toEqual({ toggleSkipped: true });
    const expanded = panelRows({ ...state, showSkipped: true }, 57).rows;
    expect((expanded.find((r) => r.kind === 'skipped') as any).text).toBe('+2 test and generated files (hide)');
    expect(expanded.some((r) => r.kind === 'title' && r.text === 'package-lock.json')).toBe(true);
    // Only the header counts the listed files.
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><DiffPanel {...state} width={57} height={16} /></ThemeProvider>);
    expect(plain(screen.lastFrame() || '')[1]).toMatch(/^ 1 file changed \+3 -1/);
    screen.unmount();
  });

  it('names the base in the header when it is not this session (Ctrl+X B)', () => {
    const file = { file: 'src/a.ts', diff, additions: 3, removals: 1 };
    const uncommitted = render(<ThemeProvider theme={loadTheme('dark')}><DiffPanel files={[file]} others={[]} showOthers={false} base="uncommitted" width={57} height={16} /></ThemeProvider>);
    expect(plain(uncommitted.lastFrame() || '')[1]).toMatch(/^ 1 file changed \+3 -1 · uncommitted +✕/);
    uncommitted.unmount();
    const branch = render(<ThemeProvider theme={loadTheme('dark')}><DiffPanel files={[file]} others={[]} showOthers={false} base="branch" branch="main" width={57} height={16} /></ThemeProvider>);
    expect(plain(branch.lastFrame() || '')[1]).toMatch(/· since main +✕/);
    branch.unmount();
    const session = render(<ThemeProvider theme={loadTheme('dark')}><DiffPanel files={[file]} others={[]} showOthers={false} base="session" width={57} height={16} /></ThemeProvider>);
    expect(plain(session.lastFrame() || '')[1]).not.toContain('·');
    session.unmount();
  });
  it('turns a mouse press and release over diff lines into the selected lines of one file', () => {
    const state = { files: [{ file: 'demo.txt', diff, additions: 3, removals: 1 }, { file: 'other.txt', diff, additions: 3, removals: 1 }], others: [], showOthers: false };
    const { rows } = panelRows(state, 57);
    const first = rows.findIndex((r) => r.kind === 'diff');
    // Body rows start at panel row 2: rows[first] is on panel row first + 2.
    const picked = panelSelection(state, 57, 40, first + 2, first + 4);
    expect(picked).toEqual({ file: 'demo.txt', lines: [' line one', '-line two', '+line 2 changed'] });
    // Released on the same row: one line.
    expect(panelSelection(state, 57, 40, first + 3, first + 3)).toEqual({ file: 'demo.txt', lines: ['-line two'] });
    // Across two files, or over the list: nothing.
    const second = rows.findIndex((r, i) => r.kind === 'diff' && i > first + 6);
    expect(panelSelection(state, 57, 40, first + 2, second + 2)).toBeNull();
    expect(panelSelection(state, 57, 40, 3, 4)).toBeNull();
  });
});

