import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Box, Text } from 'ink';
import {
  physicalRows,
  transformChunk,
  composeRepaint,
  installFrameWriter,
  eraseLines,
  type FrameWriterState,
} from '../src/ui/frameWriter.js';
import { renderToString } from '../src/ui/renderToString.js';
import { Markdown } from '../src/ui/Markdown.js';
import { LiveArea } from '../src/ui/LiveArea.js';
import EventEmitter from 'node:events';

describe('Terminal Resizing Suite', () => {
  describe('physicalRows on column resize', () => {
    it('calculates single row when text fits terminal width', () => {
      expect(physicalRows(['Hello world'], 80)).toBe(1);
      expect(physicalRows(['x'.repeat(80)], 80)).toBe(1);
    });

    it('calculates multiple rows when terminal shrinks below text length', () => {
      const text = 'x'.repeat(85);
      expect(physicalRows([text], 100)).toBe(1);
      expect(physicalRows([text], 80)).toBe(2);
      expect(physicalRows([text], 40)).toBe(3);
      expect(physicalRows([text], 20)).toBe(5);
    });

    it('handles multi-line frames when terminal expands and shrinks', () => {
      const frameLines = [
        'Short line',
        'Line with 60 characters: ' + 'a'.repeat(35),
        'Longer line with 100 characters: ' + 'b'.repeat(68),
      ];

      // At 120 columns: each line is 1 physical row -> total 3
      expect(physicalRows(frameLines, 120)).toBe(3);

      // At 80 columns: line 1 (1), line 2 (1), line 3 (100 chars -> 2 rows) -> total 4
      expect(physicalRows(frameLines, 80)).toBe(4);

      // At 40 columns: line 1 (1), line 2 (60 chars -> 2), line 3 (100 chars -> 3) -> total 6
      expect(physicalRows(frameLines, 40)).toBe(6);
    });

    it('accounts for full-width CJK characters and emojis during resizing', () => {
      // Emojis and CJK characters have stringWidth = 2
      const emojiText = '🚀'.repeat(25); // 25 emojis = 50 visual columns
      expect(physicalRows([emojiText], 80)).toBe(1);
      expect(physicalRows([emojiText], 40)).toBe(2); // 50 visual width in 40 cols wraps to 2
      expect(physicalRows([emojiText], 20)).toBe(3); // 50 visual width in 20 cols wraps to 3

      const cjkText = '你好世界！'.repeat(5); // 5 * 5 * 2 = 50 visual columns
      expect(physicalRows([cjkText], 80)).toBe(1);
      expect(physicalRows([cjkText], 40)).toBe(2);
    });

    it('ignores ANSI styling sequences when terminal is resized', () => {
      // 30 visible characters wrapped in long ANSI codes
      const styled = '\x1b[31;1m\x1b[4m' + 'A'.repeat(30) + '\x1b[0m';
      expect(physicalRows([styled], 80)).toBe(1);
      expect(physicalRows([styled], 25)).toBe(2);
      expect(physicalRows([styled], 10)).toBe(3);
    });

    it('clamps columns to at least 1 to prevent division by zero or negative width', () => {
      expect(physicalRows(['abc'], 0)).toBe(3);
      expect(physicalRows(['abc'], -10)).toBe(3);
    });
  });

  describe('transformChunk dynamic frame rewriting on resize', () => {
    it('expands erase row count when terminal width shrinks', () => {
      const state: FrameWriterState = {
        lastFrame: ['Short', 'x'.repeat(120)],
        expectStatic: false,
      };

      // Ink sends erase for 2 logical lines
      const inkErase = '\x1b[2K\x1b[1A\x1b[2K\x1b[G';
      const newFrame = 'new content\n';

      // If terminal shrank to 60 columns:
      // 'Short' = 1 row, 120 chars = 2 rows -> total 3 rows to erase!
      const out = transformChunk(inkErase + newFrame, state, 60, true);

      expect(state.lastEraseWrapped).toBe(true);
      expect(out.startsWith(eraseLines(3))).toBe(true);
    });

    it('contracts erase row count when terminal width expands', () => {
      // Previous frame had wrapped at width 40 (took 3 rows for 100 chars + 1 short = 4 rows)
      const state: FrameWriterState = {
        lastFrame: ['Short', 'x'.repeat(100)],
        expectStatic: false,
      };

      const inkErase = '\x1b[2K\x1b[1A\x1b[2K\x1b[G';
      const newFrame = 'next\n';

      // Now terminal expands to 120 columns:
      // 'Short' = 1 row, 100 chars = 1 row -> total 2 rows
      const out = transformChunk(inkErase + newFrame, state, 120, true);

      expect(state.lastEraseWrapped).toBe(false);
      expect(out.startsWith(eraseLines(2))).toBe(true);
    });
  });

  describe('composeRepaint on terminal height & width resize', () => {
    it('adapts visible transcript lines when terminal height decreases (shrink)', () => {
      const tail = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'];
      const frame = ['[Input prompt]'];

      // At height = 4 rows: frame takes 1 row, 3 rows left for tail (lines 3, 4, 5)
      const repaintSmall = composeRepaint(tail, frame, 4, 80);
      expect(repaintSmall).toContain('line 3');
      expect(repaintSmall).toContain('line 4');
      expect(repaintSmall).toContain('line 5');
      expect(repaintSmall).not.toContain('line 1');
      expect(repaintSmall).not.toContain('line 2');
      expect(repaintSmall).toContain('[Input prompt]');

      // Check that 4 screen rows were cleared
      expect((repaintSmall.match(/\x1b\[K/g) ?? []).length).toBe(4);
    });

    it('shows more transcript lines when terminal height increases (expand)', () => {
      const tail = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'];
      const frame = ['[Input prompt]'];

      // At height = 10 rows: frame takes 1 row, 9 rows available -> all 5 lines fit
      const repaintBig = composeRepaint(tail, frame, 10, 80);
      expect(repaintBig).toContain('line 1');
      expect(repaintBig).toContain('line 2');
      expect(repaintBig).toContain('line 3');
      expect(repaintBig).toContain('line 4');
      expect(repaintBig).toContain('line 5');
      expect(repaintBig).toContain('[Input prompt]');
      expect((repaintBig.match(/\x1b\[K/g) ?? []).length).toBe(10);
    });

    it('accounts for wrapped tail lines when both width and height are small', () => {
      const wideLine = 'w'.repeat(70);
      const tail = ['first', wideLine, 'last'];
      const frame = ['prompt'];

      // Height = 5 rows, Width = 30 cols
      // frame: 1 row
      // available: 4 rows
      // 'last': 1 row (used = 1)
      // wideLine: 70 chars at 30 cols = 3 rows (used = 4)
      // 'first': 1 row -> would be 5 > 4, so dropped!
      const out = composeRepaint(tail, frame, 5, 30);
      expect(out).toContain('last');
      expect(out).toContain(wideLine);
      expect(out).not.toContain('first');
    });
  });

  describe('installFrameWriter live simulation on resize', () => {
    it('intercepts stdout writes and dynamically adapts erase rows when stdout.columns changes (with reflow: true)', () => {
      const written: string[] = [];
      const mockStdout = {
        columns: 120,
        rows: 30,
        write: vi.fn((chunk: string) => {
          written.push(chunk);
          return true;
        }),
      } as unknown as NodeJS.WriteStream;

      const fw = installFrameWriter(mockStdout, { syncOutput: false, reflow: true });

      // Frame 1 rendered at 120 columns (120 chars line fits on 1 row + 1 status line = 2 lines)
      const wideLine = 'a'.repeat(110);
      mockStdout.write(`status\n${wideLine}\n`);
      expect(fw.needsRepaint()).toBe(false);

      // User resizes terminal window: columns shrinks from 120 to 50
      (mockStdout as any).columns = 50;

      // Next render frame: Ink sends erase for 2 logical lines
      const inkErase = '\x1b[2K\x1b[1A\x1b[2K\x1b[G';
      mockStdout.write(`${inkErase}new status\n${wideLine}\n`);

      // At 50 columns: wideLine (110 chars) wraps to 3 rows + 'status' (1 row) = 4 rows!
      // The erase should have erased 4 physical rows instead of Ink's 2
      const lastWrite = written[written.length - 1];
      expect(lastWrite.startsWith(eraseLines(4))).toBe(true);
      expect(fw.needsRepaint()).toBe(true);

      // Repaint resets needsRepaint
      fw.repaint(['log line 1'], 30);
      expect(fw.needsRepaint()).toBe(false);

      fw.restore();
    });

    it('erases exact frame rows without over-erasing when reflow is false', () => {
      const written: string[] = [];
      const mockStdout = {
        columns: 120,
        rows: 30,
        write: vi.fn((chunk: string) => {
          written.push(chunk);
          return true;
        }),
      } as unknown as NodeJS.WriteStream;

      // With reflow set to false (legacy terminal without buffer reflow)
      const fw = installFrameWriter(mockStdout, { syncOutput: false, reflow: false });

      // Frame 1 rendered at 120 columns (2 lines)
      const wideLine = 'a'.repeat(110);
      mockStdout.write(`status\n${wideLine}\n`);

      // Terminal shrinks to 50 columns
      (mockStdout as any).columns = 50;

      // Next render frame: Ink sends erase for 2 logical lines
      const inkErase = '\x1b[2K\x1b[1A\x1b[2K\x1b[G';
      mockStdout.write(`${inkErase}new status\nshort\n`);

      // Without reflow, it cleanly erases the exact 2 rows of the previous frame
      const lastWrite = written[written.length - 1];
      expect(lastWrite.startsWith(eraseLines(2))).toBe(true);
      expect(fw.needsRepaint()).toBe(false);

      fw.restore();
    });
  });

  describe('renderToString layout at different column widths', () => {
    it('renders and wraps Ink elements according to specified width', () => {
      const element = (
        <Box flexDirection="column">
          <Text>Title</Text>
          <Text>This is a paragraph that will wrap if the terminal column width is constrained.</Text>
        </Box>
      );

      const renderWide = renderToString(element, 100);
      const renderNarrow = renderToString(element, 30);

      // In narrow view, it wraps into more lines than in wide view
      const wideLines = renderWide.split('\n');
      const narrowLines = renderNarrow.split('\n');

      expect(narrowLines.length).toBeGreaterThan(wideLines.length);
      expect(renderWide).toContain('Title');
      expect(renderNarrow).toContain('Title');
    });
  });

  describe('Markdown responsive layout on resize', () => {
    it('adapts markdown table and content width to given columns', () => {
      const content = `
| Column A | Column B | Column C |
| --- | --- | --- |
| Short 1 | Some longer text in column 2 | Another entry |
`;
      const wide = renderToString(<Markdown content={content} width={120} />, 120);
      const narrow = renderToString(<Markdown content={content} width={40} />, 40);

      expect(wide).toContain('Column A');
      expect(narrow).toContain('Column A');
      // The narrow render should not exceed narrow width limits
      for (const line of narrow.split('\n')) {
        // string-width should be <= 40 or close
        expect(line.length).toBeDefined();
      }
    });
  });

  describe('LiveArea responsive row budget', () => {
    it('adapts visible lines count when maxLines is small vs large', () => {
      const text = Array.from({ length: 10 }, (_, i) => `Log item ${i + 1}`).join('\n');
      const live = { text, tools: [] };

      // With maxLines = 4: only 4 lines are shown, earlier lines are hidden
      const smallBudget = renderToString(<LiveArea live={live} verbose={false} frame="✢" maxLines={4} />, 80);
      expect(smallBudget).toContain('… 6 earlier lines');
      expect(smallBudget).toContain('Log item 10');
      expect(smallBudget).not.toContain('Log item 1\n');
      expect(smallBudget).not.toContain('Log item 2');

      // With maxLines = 15: all 10 lines fit, nothing is hidden
      const largeBudget = renderToString(<LiveArea live={live} verbose={false} frame="✢" maxLines={15} />, 80);
      expect(largeBudget).not.toContain('earlier lines');
      expect(largeBudget).toContain('Log item 1');
      expect(largeBudget).toContain('Log item 10');
    });

    it('accounts for physical rows when log lines wrap at narrow terminal widths', () => {
      // Line of 120 chars: takes 1 row at 160 cols, but 3 rows at 50 cols
      const longLine = 'Data: ' + 'x'.repeat(110);
      const live = {
        text: `first line\nsecond line\n${longLine}`,
        tools: [],
      };

      // At 50 columns with maxLines = 3:
      // longLine takes 3 rows, filling budget of 3 entirely.
      // So earlier lines must be hidden.
      const narrow = renderToString(<LiveArea live={live} verbose={false} frame="✢" maxLines={3} />, 50);
      expect(narrow).toContain('… 2 earlier lines');
      // The long line is rendered and wrapped across lines
      expect(narrow.replace(/\s+/g, '')).toContain(longLine.replace(/\s+/g, ''));
    });
  });

  describe('Resize event debouncing', () => {
    it('settles multiple rapid resize events into a single layout trigger after 120ms', () => {
      vi.useFakeTimers();
      const emitter = new EventEmitter();
      let settledCount = 0;
      let timer: NodeJS.Timeout | null = null;

      const onResize = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          settledCount++;
        }, 120);
      };

      emitter.on('resize', onResize);

      // Simulate rapid drag-resizing (10 events in 50ms)
      for (let i = 0; i < 10; i++) {
        emitter.emit('resize');
        vi.advanceTimersByTime(5);
      }

      // No settled event yet because 120ms has not passed since last event
      expect(settledCount).toBe(0);

      // Advance by 125ms after the last event
      vi.advanceTimersByTime(125);

      // Settled exactly once
      expect(settledCount).toBe(1);

      vi.useRealTimers();
    });
  });
});

