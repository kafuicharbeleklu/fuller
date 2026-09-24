import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { colored, parseSegments, stripSegments } from '../src/ui/segments.js';
import { TranscriptItemView } from '../src/ui/Transcript.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';

describe('coloured segments in system messages', () => {
  it('parses and strips {{colour:text}} marks', () => {
    const text = `Set model to ${colored('permission', 'Gemini 3.5 Flash')} with ${colored('permission', 'high')} effort`;
    expect(parseSegments(text)).toEqual([
      { text: 'Set model to ' }, { text: 'Gemini 3.5 Flash', color: 'permission' }, { text: ' with ' }, { text: 'high', color: 'permission' }, { text: ' effort' },
    ]);
    expect(stripSegments(text)).toBe('Set model to Gemini 3.5 Flash with high effort');
  });

  it('draws a notice and an agent event without the marks', () => {
    const theme = loadTheme('dark');
    const view = (content: string, kind: 'notice' | 'event') => {
      const screen = render(<ThemeProvider theme={theme}><TranscriptItemView item={{ key: 'k', kind: 'system', message: { id: 'm', role: 'system', content, kind, timestamp: 0 } } as any} verbose={false} banner={{} as any} /></ThemeProvider>);
      const frame = screen.lastFrame() || '';
      screen.unmount();
      return frame;
    };
    expect(view(`Set model to ${colored('permission', 'Gemini 3.5 Flash')}`, 'notice')).toContain('⎿  Set model to Gemini 3.5 Flash');
    expect(view('{{success:●}} Agent "pong" finished {{subtle:· 2s}}', 'event')).toContain('● Agent "pong" finished · 2s');
  });
});
