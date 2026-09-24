import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import { HelpDialog, SettingsDialog } from '../src/ui/InfoDialogs.js';
import { ContextView, contextCells, type ContextData } from '../src/ui/ContextView.js';

const wrap = (node: React.ReactNode) => <ThemeProvider theme={loadTheme('dark')}>{node}</ThemeProvider>;
const tick = () => new Promise((r) => setTimeout(r, 30));

describe('Claude Code style dialogs', () => {
  it('/help shows tabs, the shortcut grid and switches tabs with arrows', async () => {
    const screen = render(wrap(<HelpDialog commands={[{ name: '/clear', description: 'Start over' }]} custom={[]} onClose={() => {}} />));
    await tick();
    expect(screen.lastFrame()).toMatch(/Help {2}.*General.*Commands.*Custom commands/);
    expect(screen.lastFrame()).toContain('! for shell mode');
    screen.stdin.write('\x1b[C'); await tick();
    expect(screen.lastFrame()).toContain('/clear');
    screen.unmount();
  });

  it('/status opens Settings on Status with bold keys padded to 19 columns, Esc closes', async () => {
    const onClose = vi.fn();
    const screen = render(wrap(<SettingsDialog initialTab="status" status={[{ label: 'Version', value: '0.3.0' }, { label: 'Session name', placeholder: '/rename to add a name' }]} usage={[{ label: 'Total tokens', value: '0' }]} onClose={onClose} />));
    await tick();
    expect(screen.lastFrame()).toContain('Version:           0.3.0');
    expect(screen.lastFrame()).toContain('Session name:      /rename to add a name');
    screen.stdin.write('\t'); await tick();
    expect(screen.lastFrame()).toContain('Total tokens:');
    screen.stdin.write('\x1b'); await tick();
    expect(onClose).toHaveBeenCalledOnce();
    screen.unmount();
  });
});

describe('/context grid', () => {
  const data: ContextData = {
    modelLabel: 'Gemini 3.6 Flash (1M context)', modelId: 'gemini-3.6-flash', window: 1_000_000, bufferShare: 0.15,
    categories: [
      { name: 'System prompt', tokens: 2_400, color: 'promptBorder' },
      { name: 'System tools', tokens: 17_600, color: 'subtle' },
      { name: 'Messages', tokens: 10, color: 'autoAccept' },
    ],
    skills: { count: 0, tokens: 0 },
  };

  it('fills 200 cells like Claude Code: partial ⛀, full ⛁, free ⛶, buffer ⛝ at the end', () => {
    const cells = contextCells(data).map((cell) => cell.glyph).join('');
    expect(cells.startsWith('⛀⛁⛁⛁⛀⛀')).toBe(true);
    expect(cells.length).toBe(200);
    expect(cells.endsWith('⛝'.repeat(30))).toBe(true);
  });

  it('renders the grid with the categories on the right', () => {
    const screen = render(wrap(<ContextView data={data} />));
    const frame = screen.lastFrame() || '';
    expect(frame).toContain('⎿  Context Usage');
    expect(frame).toContain('Estimated usage by category');
    expect(frame).toMatch(/⛁ System tools: 17\.6K tokens \(1\.8%\)/i);
    screen.unmount();
  });
});

describe('/permissions and list dialogs', () => {
  it('adds a rule from the Add rule window and deletes one after confirmation', async () => {
    const { PermissionsDialog } = await import('../src/ui/PermissionsDialog.js');
    const onAddRule = vi.fn();
    const onRemoveRule = vi.fn();
    const screen = render(wrap(<PermissionsDialog allow={['Bash(ls:*)']} ask={[]} deny={[]} directories={['/tmp/p']} onAddRule={onAddRule} onRemoveRule={onRemoveRule} onAddDirectory={() => {}} onClose={() => {}} />));
    await tick();
    expect(screen.lastFrame()).toContain('Fuller won\'t ask before using allowed tools.');
    expect(screen.lastFrame()).toContain('⌕ Search…');
    expect(screen.lastFrame()).toContain('2. Bash(ls:*)');
    expect(screen.lastFrame()).toContain('←/→ to switch · ↓ to select · Esc to cancel');
    screen.stdin.write('\x1b[B'); await tick();
    expect(screen.lastFrame()).toContain('❯ 1. Add a new rule…');
    screen.stdin.write('\r'); await tick();
    expect(screen.lastFrame()).toContain('Add allow permission rule');
    expect(screen.lastFrame()).toContain('Enter permission rule…');
    screen.stdin.write('Edit(src/**)'); await tick();
    screen.stdin.write('\r'); await tick();
    expect(onAddRule).toHaveBeenCalledWith('allow', 'Edit(src/**)');
    screen.stdin.write('\x1b[B'); await tick();
    screen.stdin.write('\r'); await tick();
    expect(screen.lastFrame()).toContain('Delete rule Bash(ls:*)?');
    screen.stdin.write('\r'); await tick();
    expect(onRemoveRule).toHaveBeenCalledWith('Bash(ls:*)');
    screen.unmount();
  });

  it('has an Ask tab and filters rules after /', async () => {
    const { PermissionsDialog } = await import('../src/ui/PermissionsDialog.js');
    const onAddRule = vi.fn();
    const screen = render(wrap(<PermissionsDialog allow={[]} ask={['Bash(git push:*)', 'WebFetch']} deny={[]} directories={['/tmp/p']} onAddRule={onAddRule} onRemoveRule={() => {}} onAddDirectory={() => {}} onClose={() => {}} />));
    await tick();
    screen.stdin.write('\x1b[C'); await tick();
    expect(screen.lastFrame()).toContain('Fuller will always ask for confirmation before using these tools.');
    screen.stdin.write('/'); await tick();
    expect(screen.lastFrame()).toContain('Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear');
    screen.stdin.write('git'); await tick();
    expect(screen.lastFrame()).toContain('1. Bash(git push:*)');
    expect(screen.lastFrame()).not.toContain('WebFetch');
    expect(screen.lastFrame()).not.toContain('Add a new rule…');
    screen.unmount();
  });

  it('opens /config on the search field and changes a setting with Enter', async () => {
    const { SettingsDialog } = await import('../src/ui/InfoDialogs.js');
    const onChange = vi.fn();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const config = [
      { label: 'Auto-compact', value: 'true', options: ['true', 'false'], onChange },
      { label: 'Theme', value: 'dark', onOpen },
    ];
    const screen = render(wrap(<SettingsDialog status={[]} usage={[]} config={config} initialTab="config" onClose={onClose} />));
    await tick();
    expect(screen.lastFrame()).toContain('Settings  Status   Config   Usage');
    expect(screen.lastFrame()).toContain('⌕ Search settings…');
    expect(screen.lastFrame()).toContain('Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear');
    screen.stdin.write('\x1b[B'); await tick();
    expect(screen.lastFrame()).toMatch(/❯ Auto-compact {31}true/);
    expect(screen.lastFrame()).toContain('Enter/Space to change · / to search · Esc to close');
    screen.stdin.write('\r'); await tick();
    expect(onChange).toHaveBeenCalledWith('false');
    expect(screen.lastFrame()).toMatch(/Auto-compact +false/);
    screen.stdin.write('/'); await tick();
    screen.stdin.write('them'); await tick();
    expect(screen.lastFrame()).not.toContain('Auto-compact');
    screen.stdin.write('\r'); await tick();
    screen.stdin.write(' '); await tick();
    expect(onClose).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalled();
    screen.unmount();
  });

  it('closes the list dialog and runs the chosen action', async () => {
    const { ListDialog } = await import('../src/ui/InfoDialogs.js');
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const screen = render(wrap(<ListDialog title="Memory" items={[{ label: 'User instructions', hint: 'Saved in ~/.fuller/FULLER.md', onSelect }]} onClose={onClose} />));
    await tick();
    expect(screen.lastFrame()).toContain('❯ 1. User instructions');
    screen.stdin.write('\r'); await tick();
    expect(onClose).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalled();
    screen.unmount();
  });
});

describe('/add-dir input dialog', () => {
  it('completes directories with Tab and submits with Enter', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { InputDialog, completeDirectory } = await import('../src/ui/InfoDialogs.js');
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'adddir-'));
    fs.mkdirSync(path.join(base, 'packages'));
    fs.mkdirSync(path.join(base, 'public'));
    expect(completeDirectory('pa', base, fs, path)).toBe('packages/');
    expect(completeDirectory('p', base, fs, path)).toBe('p');
    const onSubmit = vi.fn();
    const screen = render(wrap(<InputDialog title="Add directory to workspace" label="Enter the path to the directory:" placeholder="Directory path…" complete={(v) => completeDirectory(v, base, fs, path)} onSubmit={onSubmit} onClose={() => {}} />));
    await tick();
    expect(screen.lastFrame()).toContain('Directory path…');
    screen.stdin.write('pa'); await tick();
    screen.stdin.write('\t'); await tick();
    expect(screen.lastFrame()).toContain('packages/');
    screen.stdin.write('\r'); await tick();
    expect(onSubmit).toHaveBeenCalledWith('packages/');
    screen.unmount();
  });
});
