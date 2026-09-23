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
    expect(frame).toContain('• item one');
    expect(frame).toContain('☑');
    expect(frame).toMatch(/a\s+b/);
  });
  it('renders code blocks with a language label', () => {
    const { lastFrame } = render(<Markdown content={'```ts\nconst x = 1;\n```'} width={60} />);
    expect(lastFrame()).toContain('const');
    expect(lastFrame()).toContain('ts');
  });
});

describe('DiffView', () => {
  it('parses and numbers unified diffs', () => {
    const patch = createTwoFilesPatch('a.ts', 'a.ts', 'one\ntwo\nthree\n', 'one\n2\nthree\nfour\n');
    const parsed = parseUnifiedDiff(patch);
    expect(parsed.additions).toBe(2);
    expect(parsed.removals).toBe(1);
    const { lastFrame } = render(<DiffView diff={patch} />);
    expect(lastFrame()).toContain('- two');
    expect(lastFrame()).toContain('+ 2');
    expect(lastFrame()).toContain('+ four');
  });
});
