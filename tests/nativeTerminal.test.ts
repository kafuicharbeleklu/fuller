import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import xterm from '@xterm/headless';
import { executeBash } from '../src/tools/bash.js';
import { needsNativeTerminal } from '../src/tools/nativeTerminal.js';
import { installFrameWriter } from '../src/ui/frameWriter.js';

describe('native terminal commands', () => {
  it('recognizes sudo invocations without mistaking quoted content for commands', () => {
    for (const command of ['sudo id', '/usr/bin/sudo id', 'true && sudo id', 'env X=y sudo id', 'echo "$(sudo id)"']) expect(needsNativeTerminal(command)).toBe(true);
    for (const command of ['echo sudo', "printf 'sudo id'", "grep sudo file.txt"]) expect(needsNativeTerminal(command)).toBe(false);
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
});
