import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { isTrusted, trustFolder, trustFile } from '../src/trust.js';
import { TrustDialog } from '../src/ui/TrustDialog.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import { loadEnvFiles } from '../src/config.js';

const tick = () => new Promise((r) => setTimeout(r, 30));
let home: string;
const realHome = process.env.HOME;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-trust-home-')); process.env.HOME = home; });
afterEach(() => {
  process.env.HOME = realHome;
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

describe('workspace trust', () => {
  it('trusts a folder and its sub-folders, not its siblings, and keeps the list private', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-trust-project-'));
    try {
      fs.mkdirSync(path.join(project, 'src'));
      expect(isTrusted(project)).toBe(false);
      trustFolder(project);
      trustFolder(project);
      expect(isTrusted(project)).toBe(true);
      expect(isTrusted(path.join(project, 'src'))).toBe(true);
      expect(isTrusted(`${project}-other`)).toBe(false);
      expect(JSON.parse(fs.readFileSync(trustFile(), 'utf8')).folders).toEqual([fs.realpathSync(project)]);
      expect(fs.statSync(trustFile()).mode & 0o077).toBe(0);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it('asks like Claude Code, with "No, exit" first; Esc refuses too', async () => {
    const onDecide = vi.fn();
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><TrustDialog folder="/work/repo" onDecide={onDecide} /></ThemeProvider>);
    await tick();
    const frame = screen.lastFrame()!;
    expect(frame).toContain('Accessing workspace:');
    expect(frame).toContain('/work/repo');
    expect(frame).toContain('Quick safety check: Is this a project you created or one you trust?');
    expect(frame).toMatch(/❯ No, exit\n\s+Yes, I trust this folder/);
    expect(frame).toContain('Enter to confirm · Esc to cancel');
    screen.stdin.write('\r'); await tick();
    expect(onDecide).toHaveBeenLastCalledWith(false);
    screen.stdin.write('\x1b[B'); await tick();
    screen.stdin.write('\r'); await tick();
    expect(onDecide).toHaveBeenLastCalledWith(true);
    screen.stdin.write('\x1b'); await tick();
    expect(onDecide).toHaveBeenLastCalledWith(false);
    screen.unmount();
  });

  it('reads the project .env only for a trusted folder (it could redirect the API with the key)', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-trust-env-'));
    try {
      fs.writeFileSync(path.join(project, '.env'), 'FULLER_TRUST_TEST_MARKER=from-project\n');
      delete process.env.FULLER_TRUST_TEST_MARKER;
      loadEnvFiles(project, false);
      expect(process.env.FULLER_TRUST_TEST_MARKER).toBeUndefined();
      loadEnvFiles(project, true);
      expect(process.env.FULLER_TRUST_TEST_MARKER).toBe('from-project');
      delete process.env.FULLER_TRUST_TEST_MARKER;
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
