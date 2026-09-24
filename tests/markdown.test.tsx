import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Markdown } from '../src/ui/Markdown.js';
import { DiffView, parseUnifiedDiff } from '../src/ui/DiffView.js';
import { createTwoFilesPatch } from 'diff';

describe('Markdown', () => {
  it('renders headings, lists, inline code and tables without markdown syntax', () => {
    const { lastFrame } = render(<Markdown content={'# Title\n\nSome **bold** and `code`.\n\n- item one\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |'} width={60} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Title');
    expect(frame).not.toContain('# Title');
    expect(frame).toContain('bold');
    expect(frame).not.toContain('**');
    expect(frame).toContain('- item one');
    expect(frame).toContain('☑');
    // Claude Code 2.1.281 boxes tables.
    expect(frame).toContain('┌───┬───┐');
    expect(frame).toContain('│ a │ b │');
    expect(frame).toContain('├───┼───┤');
  });
  it('renders code blocks without a language label, like Claude Code', () => {
    const { lastFrame } = render(<Markdown content={'```ts\nconst x = 1;\n```'} width={60} />);
    expect(lastFrame()).toContain('const');
    expect(lastFrame()).not.toMatch(/^\s*ts\s*$/m);
  });
});

describe('DiffView', () => {
  it('parses and numbers unified diffs', () => {
    const patch = createTwoFilesPatch('a.ts', 'a.ts', 'one\ntwo\nthree\n', 'one\n2\nthree\nfour\n');
    const parsed = parseUnifiedDiff(patch);
    expect(parsed.additions).toBe(2);
    expect(parsed.removals).toBe(1);
    const { lastFrame } = render(<DiffView diff={patch} width={40} />);
    // Claude Code 2.1.281: " <line> <sign><text>", the sign glued to the text, no trailing empty context.
    const rows = (lastFrame() || '').split('\n').map((row) => row.trimEnd());
    expect(rows).toEqual([' 1  one', ' 2 -two', ' 2 +2', ' 3  three', ' 4 +four']);
  });
});
