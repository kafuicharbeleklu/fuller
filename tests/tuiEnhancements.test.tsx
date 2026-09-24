import React from 'react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { sanitizePrompt, previousGrapheme, nextGrapheme } from '../src/ui/textInput.js';
import { transcriptLines } from '../src/ui/viewerText.js';
import { Pager, visibleColumns } from '../src/ui/Pager.js';
import { FullscreenTranscript } from '../src/ui/FullscreenTranscript.js';
import { ToolRow } from '../src/ui/ToolRow.js';
import { TranscriptItemView, wrapUserLines } from '../src/ui/Transcript.js';
import { ThemeProvider, BUILT_IN_THEMES } from '../src/ui/theme.js';
import { dispatchTool } from '../src/tools/registry.js';

describe('TUI improvements', () => {
  it('keeps combining marks and emoji together while editing', () => {
    const text = 'a\u0301👩‍💻z';
    expect(nextGrapheme(text, 0)).toBe(2);
    expect(nextGrapheme(text, 2)).toBe(text.indexOf('z'));
    expect(previousGrapheme(text, text.indexOf('z'))).toBe(2);
  });

  it('removes invisible controls while preserving script and emoji joiners', () => {
    expect(sanitizePrompt('safe\u202E text\u200B 👩‍💻')).toEqual({ text: 'safe text 👩‍💻', removed: 2 });
  });

  it('moves through long output without splitting emoji graphemes', () => {
    expect(visibleColumns('👩‍💻abcdef', 0, 4)).toBe('👩‍💻ab');
    expect(visibleColumns('👩‍💻abcdef', 2, 4)).toBe('abcd');
  });

  it('keeps full Bash output on disk while limiting what the model sees', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-output-test-'));
    try {
      const outputFile = path.join(directory, 'output.log');
      const result = await dispatchTool('execute_bash', { command: "printf 'x%.0s' {1..45000}" }, {
        cwd: directory, extraDirs: [], bashTimeoutMs: 10000, outputFile,
      });
      expect(result.output).toContain('characters truncated');
      expect(fs.readFileSync(outputFile, 'utf8')).toBe('x'.repeat(45000));
      const lines = transcriptLines([{ key: '1', kind: 'tool', messageId: 'm', toolCall: { id: '1', name: 'execute_bash', args: { command: 'test' }, status: 'completed', result: result.output, outputFile } }], true);
      expect(lines.join('\n')).toContain('x'.repeat(45000));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  it('renders stable transcript and fullscreen viewport frames', () => {
    const pager = render(<Pager title="Transcript viewer" lines={['❯ hello', '⏺ world']} onClose={() => {}} />);
    expect(pager.lastFrame()).toMatchSnapshot();
    pager.unmount();
    const fullscreen = render(<FullscreenTranscript lines={['❯ hello', '⏺ world']} height={5} scrollRequest={{ id: 0, direction: 'up' }} />);
    expect(fullscreen.lastFrame()).toMatchSnapshot();
    fullscreen.unmount();
  });

  it('formats tool calls with space after bullet and shows full output in transcript lines', () => {
    const lines = transcriptLines([
      {
        key: 'tool-1',
        kind: 'tool',
        messageId: 'm1',
        toolCall: {
          id: 't1',
          name: 'execute_bash',
          args: { command: 'ip addr', description: 'Check IP' },
          status: 'completed',
          result: '1: lo: <LOOPBACK>\n2: eth0: <BROADCAST>',
          summary: '2 lines · 50ms',
        },
      },
    ], true);

    expect(lines[0]).toBe('● Bash(ip addr) — Check IP  [2 lines · 50ms]');
    expect(lines[1]).toBe('  ⎿ 1: lo: <LOOPBACK>');
    expect(lines[2]).toBe('  ⎿ 2: eth0: <BROADCAST>');
  });

  it('renders ToolRow with explicit space between bullet and tool name', () => {
    const { lastFrame, unmount } = render(
      <ThemeProvider theme={BUILT_IN_THEMES.dark}>
        <ToolRow
          toolCall={{
            id: 't2',
            name: 'execute_bash',
            args: { command: 'echo hello' },
            status: 'completed',
            result: 'hello',
          }}
          verbose={false}
        />
      </ThemeProvider>
    );
    const frame = lastFrame() || '';
    unmount();
    expect(frame).toContain('● Bash');
    expect(frame).not.toContain('●Bash');
  });

  it('renders user messages with full width background padding', () => {
    const rows = wrapUserLines('hello world', 80);
    expect(rows).toHaveLength(1);
    expect(rows[0].prefix).toBe('❯ ');
    expect(rows[0].text).toBe('hello world');
    // Total width across terminal: prefix (3) + text (11) + pad (66) = 80
    expect(rows[0].prefix.length + rows[0].text.length + rows[0].pad).toBe(80);

    const multilineRows = wrapUserLines('first line\nsecond line is a bit longer', 60);
    expect(multilineRows).toHaveLength(2);
    for (const r of multilineRows) {
      expect(r.prefix.length + r.text.length + r.pad).toBe(60);
    }

    const { lastFrame, unmount } = render(
      <ThemeProvider theme={BUILT_IN_THEMES.dark}>
        <TranscriptItemView
          item={{
            key: 'u1',
            kind: 'user',
            message: { id: 'm1', role: 'user', content: 'hello world', timestamp: Date.now() },
          }}
          verbose={false}
          banner={{ version: '0.3.0', model: 'gemini', cwd: '/test' }}
        />
      </ThemeProvider>
    );
    const frame = lastFrame() || '';
    unmount();
    expect(frame).toContain('❯ hello world');
  });
});
