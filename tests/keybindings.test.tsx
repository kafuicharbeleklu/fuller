import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { loadKeybindings, loadKeybindingsFull, currentKeybindings, keyString, normalizeKey, parseKeybindings } from '../src/ui/keybindings.js';
import { InputBox } from '../src/ui/InputBox.js';

let home: string;
const realHome = process.env.HOME;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-keys-home-')); process.env.HOME = home; });
afterEach(() => { process.env.HOME = realHome; fs.rmSync(home, { recursive: true, force: true }); });
const write = (dir: '.fuller' | '.claude', data: unknown) => {
  fs.mkdirSync(path.join(home, dir), { recursive: true });
  fs.writeFileSync(path.join(home, dir, 'keybindings.json'), typeof data === 'string' ? data : JSON.stringify(data));
};

describe('keybindings.json', () => {
  it('reads Fuller\'s short format: known actions, lower-cased keys, null to unbind, unknown actions dropped', () => {
    write('.fuller', { bindings: { 'Ctrl+E': 'externalEditor', 'ctrl+t': null, 'alt+x': 'launchRockets', 'ctrl+y': 'diff' } });
    expect(loadKeybindings()).toEqual({ 'ctrl+e': 'externalEditor', 'ctrl+t': null, 'ctrl+y': 'diff' });
  });

  it('reads Claude Code\'s format: contexts, namespace:action names, chords, meta as alt', () => {
    const { bindings, warnings } = parseKeybindings({
      $schema: 'https://www.schemastore.org/claude-code-keybindings.json',
      bindings: [
        { context: 'Chat', bindings: { 'ctrl+e': 'chat:externalEditor', 'ctrl+k ctrl+s': 'chat:stash', 'meta+p': 'chat:modelPicker', 'ctrl+x ctrl+k': null } },
        { context: 'Global', bindings: { 'ctrl+o': 'app:toggleTranscript', 'ctrl+t': 'app:toggleTodos' } },
        { context: 'History', bindings: { 'ctrl+f': 'history:search' } },
        { context: 'Transcript', bindings: { 'q': 'transcript:exit' } },
        { context: 'Chat', bindings: { 'ctrl+q': 'chat:fastMode' } },
      ],
    });
    expect(bindings).toEqual({
      'ctrl+e': 'externalEditor', 'ctrl+k ctrl+s': 'stash', 'alt+p': 'modelPicker', 'ctrl+x ctrl+k': null,
      'ctrl+o': 'transcript', 'ctrl+t': 'tasks', 'ctrl+f': 'historySearch',
    });
    expect(warnings).toEqual(['Context "Transcript" is not supported by Fuller (ignored)', 'Unknown action "chat:fastMode" for ctrl+q (ignored)']);
    expect(normalizeKey('Ctrl+X   Ctrl+E')).toBe('ctrl+x ctrl+e');
  });

  it('falls back to ~/.claude/keybindings.json, prefers ~/.fuller, and reports a broken file', () => {
    expect(loadKeybindings()).toEqual({});
    write('.claude', { bindings: [{ context: 'Chat', bindings: { 'ctrl+e': 'chat:externalEditor' } }] });
    expect(loadKeybindingsFull()).toMatchObject({ bindings: { 'ctrl+e': 'externalEditor' }, file: path.join(home, '.claude', 'keybindings.json') });
    write('.fuller', '{ not json');
    const broken = loadKeybindingsFull();
    expect(broken.bindings).toEqual({});
    expect(broken.warnings[0]).toContain(path.join(home, '.fuller', 'keybindings.json'));
  });

  it('applies changes to the file without a restart', () => {
    write('.fuller', { bindings: { 'ctrl+e': 'externalEditor' } });
    expect(currentKeybindings()).toEqual({ 'ctrl+e': 'externalEditor' });
    write('.fuller', { bindings: { 'ctrl+y': 'undo' } });
    const file = path.join(home, '.fuller', 'keybindings.json');
    const later = new Date(Date.now() + 2000);
    fs.utimesSync(file, later, later);
    expect(currentKeybindings()).toEqual({ 'ctrl+y': 'undo' });
  });

  it('names key events the way the file does', () => {
    expect(keyString({ name: 'char', text: 'E', ctrl: true, alt: false, shift: false, raw: '\x05' })).toBe('ctrl+e');
    expect(keyString({ name: 'up', text: '', ctrl: false, alt: true, shift: false, raw: '' } as any)).toBe('alt+up');
  });

  it('runs a bound chord from the prompt, and lets the built-in Ctrl+X chords through', async () => {
    write('.fuller', { bindings: [{ context: 'Chat', bindings: { 'ctrl+k ctrl+t': 'app:toggleTodos' } }] });
    let todos = 0, sent = 0;
    const screen = render(<InputBox isActive busy={false} queue={[]} history={[]} cwd="/tmp" commands={[]} showHelp={false}
      onSubmit={() => {}} onCommand={() => {}} onBash={() => {}} onSendNow={() => { sent++; }} onToggleTodos={() => { todos++; }}
      onInterrupt={() => {}} onExit={() => {}} onCycleMode={() => {}} onClearScreen={() => {}} onToggleVerbose={() => {}}
      onToggleHelp={() => {}} onDoubleEscape={() => {}} onPopQueue={() => undefined} />);
    const settle = () => new Promise((r) => setTimeout(r, 40));
    for (let i = 0; i < 30; i++) { screen.stdin.write('z'); await settle(); if ((screen.lastFrame() ?? '').includes('z')) break; }
    screen.stdin.write('\x0b'); await settle();
    screen.stdin.write('\x14'); await settle();
    expect(todos).toBe(1);
    screen.stdin.write('\x18'); await settle();
    screen.stdin.write('\x13'); await settle();
    expect(sent).toBe(1);
    screen.unmount();
  });
});
