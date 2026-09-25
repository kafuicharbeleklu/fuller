import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { DiffViewer, turnViews } from '../src/ui/DiffViewer.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import type { ChatMessage } from '../src/agent/types.js';

const plain = (frame: string) => frame.replace(/\x1b\[[0-9;]*m/g, '');
const diff = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n one\n-two\n+deux\n+trois\n';
const tool = (name: string, file: string, d: string | undefined, status = 'completed') => ({ type: 'tool' as const, id: 't', toolCall: { id: 't', name, args: { file_path: file }, status, startTime: 0, diff: d } });
const messages: ChatMessage[] = [
  { id: 'u1', role: 'user', content: 'Fix the parser\nwith care', kind: 'normal', timestamp: 1 },
  { id: 'a1', role: 'assistant', content: '', timestamp: 2, parts: [tool('read_file', 'src/a.ts', undefined), tool('edit_file', 'src/a.ts', diff)] as any },
  { id: 'u2', role: 'user', content: 'now the docs', kind: 'normal', timestamp: 3 },
  { id: 'a2', role: 'assistant', content: 'Only read.', timestamp: 4, parts: [tool('read_file', 'README.md', undefined)] as any },
  { id: 'u3', role: 'user', content: 'and a shell change', kind: 'normal', timestamp: 5 },
  { id: 'a3', role: 'assistant', content: '', timestamp: 6, parts: [tool('write_file', 'b.txt', 'diff --git a/b.txt b/b.txt\n--- /dev/null\n+++ b/b.txt\n@@ -0,0 +1 @@\n+b\n'), tool('edit_file', 'b.txt', undefined, 'failed')] as any },
];
const wait = () => new Promise((r) => setTimeout(r, 30));

describe('classic /diff viewer (Claude Code docs: Current and turn views)', () => {
  it('builds a view for each prompt after which files were edited, from the tool calls', () => {
    const views = turnViews(messages);
    expect(views.map((v) => v.label)).toEqual(['Turn 1: Fix the parser', 'Turn 3: and a shell change']);
    expect(views[0].files).toEqual([{ file: 'src/a.ts', diff, additions: 2, removals: 1 }]);
    expect(views[1].files.map((f) => f.file)).toEqual(['b.txt']);
  });

  it('lists Current, moves between views with Left and Right, opens a file with Enter and returns with Esc', async () => {
    const onClose = vi.fn();
    const data = { current: [{ file: 'x.ts', diff, additions: 2, removals: 1 }, { file: 'y.ts', diff, additions: 2, removals: 1 }], currentBase: 'uncommitted' as const, turns: turnViews(messages) };
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><DiffViewer data={data} onClose={onClose} /></ThemeProvider>);
    await wait();
    let frame = plain(screen.lastFrame() || '');
    expect(frame).toContain('Current  Turn 1: Fix the parser  Turn 3: and a shell change');
    expect(frame).toContain('❯ x.ts +2 -1');
    expect(frame).toContain('uncommitted changes · ↑/↓ to select · Enter to open · Esc to close');
    screen.stdin.write('\x1b[B'); await wait();
    expect(plain(screen.lastFrame() || '')).toContain('❯ y.ts');
    screen.stdin.write('\x1b[C'); await wait();
    frame = plain(screen.lastFrame() || '');
    expect(frame).toContain('❯ src/a.ts +2 -1');
    expect(frame).toContain('edits made in this turn');
    screen.stdin.write('\r'); await wait();
    frame = plain(screen.lastFrame() || '');
    expect(frame).toContain('src/a.ts +2 -1');
    expect(frame).toContain('-two');
    expect(frame).toContain('+deux');
    expect(frame).toContain('Esc to return to the list');
    screen.stdin.write('\x1b'); await wait();
    expect(plain(screen.lastFrame() || '')).toContain('❯ src/a.ts');
    expect(onClose).not.toHaveBeenCalled();
    screen.stdin.write('\x1b'); await wait();
    expect(onClose).toHaveBeenCalledTimes(1);
    screen.unmount();
  });

  it('says where Current comes from when the working tree is clean', async () => {
    const data = { current: [{ file: 'x.ts', diff, additions: 2, removals: 1 }], currentBase: 'branch' as const, branch: 'main', turns: [] };
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><DiffViewer data={data} onClose={() => {}} /></ThemeProvider>);
    await wait();
    expect(plain(screen.lastFrame() || '')).toContain('what this branch adds on top of main');
    screen.unmount();
  });
});
