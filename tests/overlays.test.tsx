import React from 'react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import { Select } from '../src/ui/Select.js';
import { ModelPicker } from '../src/ui/ModelPicker.js';
import { OverlayFrame } from '../src/ui/OverlayFrame.js';
import { FullscreenTranscript } from '../src/ui/FullscreenTranscript.js';
import { renderToString } from '../src/ui/renderToString.js';
import { transcriptLines } from '../src/ui/viewerText.js';
import { saveDefaultModel } from '../src/config.js';
import type { ModelInfo } from '../src/agent/models.js';

const models: ModelInfo[] = [
  'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-pro',
].map((id) => ({ id, displayName: id, description: id === 'gemini-3.8-flash' ? 'Best for complex coding tasks' : undefined, inputTokenLimit: 1_048_576, outputTokenLimit: 65_536, actions: ['generateContent'] }));

vi.mock('../src/agent/models.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/agent/models.js')>(),
  listChatModels: vi.fn(async () => models),
}));

const wrap = (child: React.ReactNode) => <ThemeProvider theme={loadTheme('dark')}>{child}</ThemeProvider>;

describe('picker overlays', () => {
  it('shows the current model inside an open, numbered panel with a compact footer', async () => {
    const screen = render(wrap(<ModelPicker apiKey="test" current="gemini-2.5-pro" onSelect={() => {}} onCancel={() => {}} />));
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('Gemini 2.5 Pro'));
    const frame = screen.lastFrame() || '';
    expect(frame).toMatchSnapshot();
    expect(frame).toContain('6. Gemini 2.5 Pro ✔');
    // Claude Code's dialog layout (2.1.283 binary and captures): rule, title and description, a blank
    // line, the list, a blank line before the effort row, a blank line, the key hint.
    const panel = frame.trimStart().split('\n').map((row) => row.trimEnd());
    expect(panel[0]).toMatch(/^▔+$/);
    expect(panel[1]).toBe('   Select model');
    expect(panel[2]).toMatch(/^   Switch between Gemini models/);
    const list = panel.findIndex((row) => row.includes('1. Gemini'));
    expect(panel[list - 1]).toBe('');
    // Gemini 2.5 Pro has no effort levels: said one blank line under the list, as Claude Code does for Haiku.
    expect(panel.at(-4)).toBe('');
    expect(panel.at(-3)).toBe('   ○ Effort not supported for Gemini 2.5 Pro');
    expect(panel.at(-2)).toBe('');
    expect(panel.at(-1)).toBe('   Enter to set as default · s to use this session only · Esc to cancel');
    expect(frame).not.toContain('PgUp');
    expect(frame).toContain('Enter to set as default · s to use this session only');
    expect(frame).not.toMatch(/[╭╮╰╯]/);
    screen.unmount();
  });

  it('supports paging and choosing the selected model for this session', async () => {
    const onSelect = vi.fn();
    const screen = render(wrap(<ModelPicker apiKey="test" current="gemini-2.5-pro" onSelect={onSelect} onCancel={() => {}} />));
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('Gemini 2.5 Pro'));
    await new Promise((resolve) => setImmediate(resolve));
    screen.stdin.write('\x1b[H');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('❯ 1. Gemini 3.8 Flash'));
    screen.stdin.write('s');
    // Flash thinks at its highest level by default (quality over speed).
    expect(onSelect).toHaveBeenCalledWith(models[0], 'session', 'high');
    screen.stdin.write('\r');
    expect(onSelect).toHaveBeenLastCalledWith(models[0], 'default', 'high');
    screen.unmount();
  });

  it('adjusts supported Gemini thinking levels with Left and Right', async () => {
    const onSelect = vi.fn();
    const screen = render(wrap(<ModelPicker apiKey="test" current="gemini-3.8-flash" onSelect={onSelect} onCancel={() => {}} />));
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('● High effort (default) ←/→ to adjust'));
    // The key listener is attached by an effect after the first frame: under load an early key is lost.
    for (let i = 0; i < 40 && !(screen.lastFrame() ?? '').includes('◐ Medium effort'); i++) {
      screen.stdin.write('\x1b[D');
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('◐ Medium effort ←/→ to adjust'));
    screen.stdin.write('\x1b[D');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('○ Low effort ←/→ to adjust'));
    screen.stdin.write('\r');
    expect(onSelect).toHaveBeenCalledWith(models[0], 'default', 'low');
    screen.unmount();
  });

  it('wraps effort levels around like Claude Code and keeps the level across models', async () => {
    const onSelect = vi.fn();
    const screen = render(wrap(<ModelPicker apiKey="test" current="gemini-3.8-flash" thinkingLevel="medium" onSelect={onSelect} onCancel={() => {}} />));
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('◐ Medium effort ←/→ to adjust'));
    await new Promise((resolve) => setImmediate(resolve));
    screen.stdin.write('\x1b[C');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('● High effort (default)'));
    screen.stdin.write('\x1b[C');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('○ Low effort'));
    screen.stdin.write('\x1b[D');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('● High effort'));
    screen.stdin.write('\x1b[B');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('❯ 2. Gemini 3.7 Flash'));
    expect(screen.lastFrame()).toContain('● High effort');
    screen.stdin.write('s');
    expect(onSelect).toHaveBeenCalledWith(models[1], 'session', 'high');
    screen.unmount();
  });

  it('falls back to the nearest level a model supports', async () => {
    const { keepLevel } = await import('../src/ui/ModelPicker.js');
    expect(keepLevel('gemini-3.8-flash', 'minimal')).toBe('low');
    expect(keepLevel('gemini-3-pro-preview', 'medium')).toBe('low');
    expect(keepLevel('gemini-2.5-pro', 'high')).toBeUndefined();
  });

  it('keeps the panel inside a tiny terminal', () => {
    const frame = renderToString(wrap(
      <OverlayFrame title="Select model" description="Choose a Gemini model" hint="Enter save · s · Esc">
        <Text>1. Gemini Flash</Text>
      </OverlayFrame>
    ), 24, 10);
    expect(frame).toMatchSnapshot();
    expect(frame.split('\n').length).toBeLessThanOrEqual(10);
    expect(frame.split('\n').every((line) => line.length <= 23)).toBe(true);
  });

  it('keeps the latest conversation row visible above a short fullscreen picker', () => {
    const frame = renderToString(wrap(<FullscreenTranscript lines={['old message', 'latest message']} height={1} scrollRequest={{ id: 0, direction: 'up' }} />), 60, 18);
    expect(frame.split('\n')).toHaveLength(1);
    expect(frame).toContain('latest message');
    expect(frame).not.toContain('old message');
  });

  it('navigates generic lists with arrows, Home/End, PageUp/PageDown and Ctrl+N/P', async () => {
    const onSelect = vi.fn();
    const screen = render(wrap(<Select items={Array.from({ length: 8 }, (_, i) => ({ label: `Item ${i + 1}`, value: i }))} maxVisible={3} onSelect={onSelect} />));
    await new Promise((resolve) => setImmediate(resolve));
    screen.stdin.write('\x1b[F');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('❯ 8. Item 8'));
    screen.stdin.write('\x1b[5~');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('❯ 5. Item 5'));
    expect(screen.lastFrame()).toMatchSnapshot('paged list with hidden items');
    screen.stdin.write('\x10');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('❯ 4. Item 4'));
    screen.stdin.write('\x0e');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('❯ 5. Item 5'));
    screen.stdin.write('\x1b[<65;10;10M');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('❯ 6. Item 6'));
    screen.stdin.write('\x1b[<64;10;10M');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('❯ 5. Item 5'));
    screen.stdin.write('\r');
    expect(onSelect).toHaveBeenCalledWith(4, 4);
    screen.unmount();
  });

  it('saves a default model without removing other user settings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-model-default-'));
    try {
      fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'lagoon', maxTurns: 25 }));
      const file = saveDefaultModel('gemini-3.8-flash', dir);
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ theme: 'lagoon', maxTurns: 25, model: 'gemini-3.8-flash' });
      saveDefaultModel('gemini-3.8-flash', dir, 'low');
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).thinkingLevel).toBe('low');
      saveDefaultModel('gemini-2.5-pro', dir);
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).thinkingLevel).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows model-command feedback under the command in fullscreen transcript text', () => {
    const command = { id: 'command', role: 'user' as const, content: '/model', kind: 'command' as const, timestamp: 0 };
    const feedback = { id: 'feedback', role: 'system' as const, content: 'Kept model as Gemini 2.5 Pro', kind: 'notice' as const, timestamp: 0 };
    expect(transcriptLines([
      { key: 'command', kind: 'user', message: command },
      { key: 'feedback', kind: 'system', message: feedback },
    ], false)).toEqual(['❯ /model', '  ⎿ Kept model as Gemini 2.5 Pro', '']);
  });
});
