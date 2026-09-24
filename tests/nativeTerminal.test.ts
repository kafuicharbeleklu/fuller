import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import xterm from '@xterm/headless';
import { executeBash } from '../src/tools/bash.js';
import { desktopAuthentication, needsNativeTerminal } from '../src/tools/nativeTerminal.js';
import { dispatchTool } from '../src/tools/registry.js';
import { authPanel, installFrameWriter } from '../src/ui/frameWriter.js';

describe('native terminal commands', () => {
  it('recognizes sudo invocations without mistaking quoted content for commands', () => {
    for (const command of ['sudo id', '/usr/bin/sudo id', 'true && sudo id', 'env X=y sudo id', 'echo "$(sudo id)"']) expect(needsNativeTerminal(command)).toBe(true);
    for (const command of ['echo sudo', "printf 'sudo id'", "grep sudo file.txt"]) expect(needsNativeTerminal(command)).toBe(false);
  });

  it('refuses commands that would authenticate in a desktop window', async () => {
    for (const command of ['pkexec apt update', 'sudo -A apt update', 'sudo -kA true', 'sudo --askpass id', 'true && /usr/bin/pkexec id']) expect(desktopAuthentication(command)).toBeTruthy();
    for (const command of ['sudo apt update', 'sudo -k true', 'echo pkexec', 'sudo -u admin id']) expect(desktopAuthentication(command)).toBeNull();
    await expect(dispatchTool('execute_bash', { command: 'pkexec true' }, { cwd: '/tmp', bashTimeoutMs: 1000 })).rejects.toThrow(/Run the command with plain sudo instead/);
  });

  it('hands off once and captures the result without restarting the command', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-native-'));
    try {
      fs.writeFileSync(path.join(cwd, 'sudo'), '#!/bin/sh\necho started >> count\nprintf AUTH_RESULT\n', { mode: 0o700 });
      const runInTerminal = vi.fn(async (run) => run());
      const onBackgroundReady = vi.fn();
      const result = await executeBash('sudo simulated', cwd, {
        env: { PATH: `${cwd}:${process.env.PATH}` }, runInTerminal, onBackgroundReady,
        outputFile: path.join(cwd, 'output.log'),
      });
      expect(runInTerminal).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ stdout: 'AUTH_RESULT', exitCode: 0 });
      expect(fs.readFileSync(path.join(cwd, 'count'), 'utf8')).toBe('started\n');
      expect(fs.readFileSync(path.join(cwd, 'output.log'), 'utf8')).toBe('AUTH_RESULT');
      expect(onBackgroundReady).not.toHaveBeenCalled();
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });

  it('does not launch a command cancelled while waiting for the terminal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(executeBash('sudo simulated', '/tmp', {
      signal: controller.signal, runInTerminal: async (run) => run(),
    })).rejects.toThrow('Interrupted');
  });

  it('defers paints and preserves committed output while the child owns the terminal', async () => {
    const chunks: string[] = [];
    const stdout = { columns: 80, rows: 24, write: (chunk: string) => { chunks.push(chunk); return true; } } as NodeJS.WriteStream;
    const writer = installFrameWriter(stdout, { syncOutput: false });
    const erase = '\x1b[2K\x1b[1A\x1b[2K\x1b[G';
    try {
      stdout.write('RUNNING_OLD\n');
      const resume = writer.suspend(false);
      const count = chunks.length;
      stdout.write(erase);
      stdout.write('BACKGROUND_RESULT_UNIQUE\n');
      stdout.write('RUNNING_NEW\n');
      expect(chunks).toHaveLength(count);
      chunks.push('SIMULATED_PASSWORD: \r\n'); // Native child writes directly to the TTY.
      resume();
      resume(); // Cleanup is idempotent.
      const terminal = new xterm.Terminal({ cols: 80, rows: 24, convertEol: true, allowProposedApi: true });
      await new Promise<void>((resolve) => terminal.write(chunks.join(''), resolve));
      const buffer = terminal.buffer.active;
      const text = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)!.translateToString(true)).join('\n').trimEnd();
      terminal.dispose();
      expect(text).not.toContain('RUNNING_OLD');
      expect(text.match(/BACKGROUND_RESULT_UNIQUE/g)).toHaveLength(1);
      expect(text).toMatchSnapshot();
    } finally { writer.restore(); }
  });

  const replay = async (chunks: string[], columns: number, rows: number) => {
    const terminal = new xterm.Terminal({ cols: columns, rows, convertEol: true, allowProposedApi: true });
    await new Promise<void>((resolve) => terminal.write(chunks.join(''), resolve));
    const buffer = terminal.buffer.active;
    const lines = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)!.translateToString(true));
    terminal.dispose();
    return lines;
  };

  it('keeps Fuller on screen in fullscreen: the sudo password box takes the bottom rows', async () => {
    const chunks: string[] = [];
    const stdout = { columns: 60, rows: 12, write: (chunk: string) => { chunks.push(chunk); return true; } } as NodeJS.WriteStream;
    const writer = installFrameWriter(stdout, { syncOutput: false });
    try {
      stdout.write(`${Array.from({ length: 11 }, (_, i) => (i === 3 ? '● Bash(sudo apt update)' : `line ${i}`)).join('\n')}\n`);
      const resume = writer.suspend(true, { auth: 'sudo apt update' });
      expect(chunks.join('')).not.toContain('\x1b[?1049l');
      chunks.push('[sudo: authenticate] Password: '); // sudo writes on the last row.
      const during = await replay(chunks, 60, 12);
      expect(during[3]).toBe('● Bash(sudo apt update)');
      expect(during.slice(7, 12).map((l) => l.trimEnd())).toEqual([
        '─'.repeat(59),
        ' Password required',
        '   sudo apt update',
        ' sudo reads it directly: Fuller never sees it · Ctrl+C to…',
        ' [sudo: authenticate] Password:',
      ]);
      resume();
      const after = await replay(chunks, 60, 12);
      expect(after.join('\n')).not.toContain('Password required');
      expect(after[3]).toBe('● Bash(sudo apt update)');
    } finally { writer.restore(); }
  });

  it('shows the password box in place of the frame in classic mode', async () => {
    const chunks: string[] = [];
    const stdout = { columns: 80, rows: 24, write: (chunk: string) => { chunks.push(chunk); return true; } } as NodeJS.WriteStream;
    const writer = installFrameWriter(stdout, { syncOutput: false });
    try {
      stdout.write('● Bash(sudo -k true)\n  ⎿  Running…\n');
      const resume = writer.suspend(false, { auth: 'sudo -k true' });
      const during = (await replay(chunks, 80, 24)).map((l) => l.trimEnd()).filter(Boolean);
      expect(during).toEqual(['─'.repeat(79), ' Password required', '   sudo -k true', ' sudo reads it directly: Fuller never sees it · Ctrl+C to cancel']);
      resume();
    } finally { writer.restore(); }
  });

  it('fits the password box to narrow terminals and long commands', () => {
    const lines = authPanel(`sudo apt install ${'package '.repeat(20)}\nsecond line`, 40);
    expect(lines).toHaveLength(5);
    expect(lines[2]).toMatch(/…$/);
    for (const line of lines) expect(line.replace(/\x1b\[[0-9;]*m/g, '').length).toBeLessThanOrEqual(39);
  });
});

