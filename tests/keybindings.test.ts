import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadKeybindings, keyString } from '../src/ui/keybindings.js';

// The loader was never tested: the input tests replace it with {} (report of 25/09, defect 6).
let home: string;
const realHome = process.env.HOME;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-keys-home-')); process.env.HOME = home; });
afterEach(() => { process.env.HOME = realHome; fs.rmSync(home, { recursive: true, force: true }); });
const write = (data: unknown) => {
  fs.mkdirSync(path.join(home, '.fuller'), { recursive: true });
  fs.writeFileSync(path.join(home, '.fuller', 'keybindings.json'), typeof data === 'string' ? data : JSON.stringify(data));
};

describe('~/.fuller/keybindings.json', () => {
  it('reads known actions, lower-cases the keys, keeps null to unbind and drops unknown actions', () => {
    write({ bindings: { 'Ctrl+E': 'externalEditor', 'ctrl+t': null, 'alt+x': 'launchRockets', 'ctrl+y': 'diff' } });
    expect(loadKeybindings()).toEqual({ 'ctrl+e': 'externalEditor', 'ctrl+t': null, 'ctrl+y': 'diff' });
  });

  it('returns no binding for a missing or broken file', () => {
    expect(loadKeybindings()).toEqual({});
    write('{ not json');
    expect(loadKeybindings()).toEqual({});
  });

  it('names key events the way the file does', () => {
    expect(keyString({ name: 'char', text: 'E', ctrl: true, alt: false, shift: false, raw: '\x05' })).toBe('ctrl+e');
    expect(keyString({ name: 'up', text: '', ctrl: false, alt: true, shift: false, raw: '' } as any)).toBe('alt+up');
  });
});
