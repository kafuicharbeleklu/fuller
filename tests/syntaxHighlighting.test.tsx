import React from 'react';
import stripAnsi from 'strip-ansi';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import { Markdown } from '../src/ui/Markdown.js';
import { DiffView } from '../src/ui/DiffView.js';

vi.mock('cli-highlight', () => ({
  highlight: (code: string) => `«${code}»`,
  supportsLanguage: () => true,
}));

const withSyntax = (on: boolean, child: React.ReactNode) => <ThemeProvider theme={{ ...loadTheme('dark'), syntaxHighlighting: on }}>{child}</ThemeProvider>;

describe('syntax highlighting setting', () => {
  it('highlights Markdown code blocks only when enabled', () => {
    const md = '```js\nconst answer = 42;\n```';
    expect(render(withSyntax(true, <Markdown content={md} width={40} />)).lastFrame()).toContain('«const answer = 42;»');
    const off = render(withSyntax(false, <Markdown content={md} width={40} />)).lastFrame()!;
    expect(off).toContain('const answer = 42;');
    expect(off).not.toContain('«');
  });

  it('highlights diff lines only when a language is given and highlighting is enabled', () => {
    const diff = '--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-let a = 1;\n+let a = 2;';
    // The changed word gets its own background: compare the visible text.
    expect(stripAnsi(render(withSyntax(true, <DiffView diff={diff} language="javascript" />)).lastFrame() ?? '')).toContain('«let a = 2;»');
    expect(render(withSyntax(false, <DiffView diff={diff} language="javascript" />)).lastFrame()).not.toContain('«');
    expect(render(withSyntax(true, <DiffView diff={diff} />)).lastFrame()).not.toContain('«');
  });
});
