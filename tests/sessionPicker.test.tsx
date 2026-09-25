import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { SessionPicker, timeAgo } from '../src/ui/SessionPicker.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import type { SessionMeta } from '../src/session/store.js';

const session = (id: string, title: string, gitBranch: string): SessionMeta => ({
  id, title, gitBranch, workspaceDir: '/tmp/demo-project', model: 'gemini-3.6-flash', createdAt: 0, updatedAt: Date.now() - 5_000, messageCount: 3, tokenCount: 0, sizeBytes: 186_060,
});

describe('/resume session picker (Claude Code 2.1.281 layout)', () => {
  it('shows the framed search, the project and two-line sessions', () => {
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><SessionPicker sessions={[session('a', 'Reply with ok', 'HEAD')]} onSelect={() => {}} onCancel={() => {}} /></ThemeProvider>);
    const frame = screen.lastFrame() || '';
    expect(frame).toContain('Resume session');
    expect(frame).toContain('⌕ Search…');
    expect(frame).toContain('demo-project');
    expect(frame).toContain('❯ Reply with ok');
    expect(frame).toMatch(/5 seconds ago · HEAD · 181\.7KB/);
    expect(frame).toContain('Type to search · Esc to cancel');
    screen.unmount();
  });

  it('filters by typing, clears the filter with Esc, then cancels, and filters by branch with ctrl+b', async () => {
    const onCancel = vi.fn();
    const onSelect = vi.fn();
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><SessionPicker branch="main" sessions={[session('a', 'Alpha task', 'main'), session('b', 'Beta task', 'dev')]} onSelect={onSelect} onCancel={onCancel} /></ThemeProvider>);
    const keys = async (...sequences: string[]) => { for (const s of sequences) { screen.stdin.write(s); await new Promise((r) => setTimeout(r, 30)); } };
    await new Promise((r) => setImmediate(r));
    await keys('beta');
    await vi.waitFor(() => {
      expect(screen.lastFrame()).toContain('Type to Search · Enter to select · Esc to clear');
      expect(screen.lastFrame()).not.toContain('Alpha task');
    });
    await keys('\x1b');
    await vi.waitFor(() => {
      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.lastFrame()).toContain('Alpha task');
    });
    await keys('\x02');
    await vi.waitFor(() => {
      expect(screen.lastFrame()).not.toContain('Beta task');
    });
    await keys('\r');
    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith('a', '/tmp/demo-project');
    });
    await keys('\x1b');
    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalledOnce();
    });
    screen.unmount();
  });

  it('lists every project with ctrl+a, renames with ctrl+r and previews with space', async () => {
    const onRename = vi.fn();
    const onSelect = vi.fn();
    const other = { ...session('z', 'Elsewhere', 'main'), workspaceDir: '/srv/other-repo' };
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><SessionPicker sessions={[session('a', 'Alpha task', 'main')]} allSessions={() => [other, session('a', 'Alpha task', 'main')]} onRename={onRename} onSelect={onSelect} onCancel={() => {}} /></ThemeProvider>);
    const keys = async (...sequences: string[]) => { for (const s of sequences) { screen.stdin.write(s); await new Promise((r) => setTimeout(r, 30)); } };
    await new Promise((r) => setImmediate(r));
    expect(screen.lastFrame()).toContain('Ctrl+A to show all projects');
    expect(screen.lastFrame()).toContain('Space to preview');
    await keys('\x01');
    await vi.waitFor(() => {
      expect(screen.lastFrame()).toContain('❯ Elsewhere');
      expect(screen.lastFrame()).toContain('/srv/other-repo');
      expect(screen.lastFrame()).toContain('Ctrl+A to only show current repo');
    });
    await keys('\x12');
    await vi.waitFor(() => {
      expect(screen.lastFrame()).toContain('Rename session:');
      expect(screen.lastFrame()).toContain('Enter new session name');
    });
    await keys('New name', '\r');
    await vi.waitFor(() => {
      expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'z' }), 'New name');
      expect(screen.lastFrame()).toContain('❯ New name');
    });
    await keys(' ');
    await vi.waitFor(() => {
      expect(screen.lastFrame()).toContain('Enter to resume · Esc to cancel');
      expect(screen.lastFrame()).toContain('3 messages · main');
    });
    await keys('\r');
    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith('z', '/srv/other-repo');
    });
    screen.unmount();
  });

  it('deletes a session after confirmation with Ctrl+Delete, as Antigravity does', async () => {
    const onDelete = vi.fn(() => true);
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><SessionPicker sessions={[session('a', 'Alpha task', 'main'), session('b', 'Beta task', 'main')]} onDelete={onDelete} onSelect={() => {}} onCancel={() => {}} /></ThemeProvider>);
    const keys = async (...sequences: string[]) => { for (const s of sequences) { screen.stdin.write(s); await new Promise((r) => setTimeout(r, 30)); } };
    await new Promise((r) => setImmediate(r));
    expect(screen.lastFrame()).toContain('Ctrl+Del to delete');
    await keys('\x1b[3;5~'); // Ctrl+Delete
    await vi.waitFor(() => {
      expect(screen.lastFrame()).toContain('Delete this conversation?');
      expect(screen.lastFrame()).toContain('Alpha task');
      expect(screen.lastFrame()).toContain('This cannot be undone.');
      expect(screen.lastFrame()).toContain('Enter or Y to delete · Esc or N to cancel');
    });
    await keys('n');
    await vi.waitFor(() => {
      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.lastFrame()).toContain('❯ Alpha task');
    });
    await keys('\x1b[3;5~', 'y');
    await vi.waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
      expect(screen.lastFrame()).not.toContain('Alpha task\n');
      expect(screen.lastFrame()).toContain('Deleted "Alpha task"');
      expect(screen.lastFrame()).toContain('❯ Beta task');
    });
    screen.unmount();
  });

  it('writes ages like Claude Code', () => {
    expect(timeAgo(0, 5_000)).toBe('5 seconds ago');
    expect(timeAgo(0, 60_000)).toBe('1 minute ago');
    expect(timeAgo(0, 3 * 3_600_000)).toBe('3 hours ago');
  });
});

describe('deleting a stored session', () => {
  it('removes the session file with its rewind history and command outputs', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-del-home-'));
    const { saveSessionSync, sessionsDir, deleteSession, listSessions } = await import('../src/session/store.js');
    const ws = '/tmp/demo-delete-project';
    saveSessionSync({ meta: { id: 's1', workspaceDir: ws, model: 'm', createdAt: 0, updatedAt: 1, messageCount: 1, tokenCount: 0 }, messages: [] } as any);
    const dir = sessionsDir(ws);
    fs.mkdirSync(path.join(dir, 'rewind', 's1'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'outputs', 's1'), { recursive: true });
    expect(listSessions(ws).map((s) => s.id)).toEqual(['s1']);
    expect(deleteSession(ws, 's1')).toBe(true);
    expect(listSessions(ws)).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'rewind', 's1'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'outputs', 's1'))).toBe(false);
    expect(deleteSession(ws, '../escape')).toBe(false);
  });
});
