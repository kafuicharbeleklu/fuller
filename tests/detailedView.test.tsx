import React from 'react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import { TranscriptItemView, messageTime } from '../src/ui/Transcript.js';
import { renderToString } from '../src/ui/renderToString.js';
import { messagesToTranscript } from '../src/agent/transcript.js';

const wrap = (child: React.ReactNode) => <ThemeProvider theme={loadTheme('dark')}>{child}</ThemeProvider>;
const at = new Date(2026, 8, 26, 7, 48).getTime();
const item = { key: 'a', kind: 'text' as const, messageId: 'm', content: 'The directory contains one file.', timestamp: at, model: 'gemini-3.8-flash' };

describe('detailed view (Ctrl+O), Claude Code 2.1.283 capture 4.2', () => {
  it('puts the time and the model above an answer, on the right, 8 columns from the edge', () => {
    const rows = renderToString(wrap(<TranscriptItemView item={item} verbose />), 100).split('\n');
    expect(rows[0]).toBe('');
    expect(rows[1].trimEnd().endsWith('07:48 AM gemini-3.8-flash')).toBe(true);
    expect(rows[1].trimEnd().length).toBe(92);
    expect(rows[2]).toContain('● The directory contains one file.');
  });

  it('shows nothing extra in the normal view or without a model', () => {
    expect(renderToString(wrap(<TranscriptItemView item={item} verbose={false} />), 100)).not.toContain('gemini-3.8-flash');
    const { model: _model, ...plain } = item;
    const rows = renderToString(wrap(<TranscriptItemView item={plain} verbose />), 100).split('\n');
    expect(rows[1]).toContain('● The directory contains one file.');
  });

  it('formats the time as Claude Code does and keeps the model through a resumed session', () => {
    expect(messageTime(new Date(2026, 8, 26, 15, 5).getTime())).toBe('03:05 PM');
    const items = messagesToTranscript([{ id: 'm', role: 'assistant', content: 'x', timestamp: at, parts: [{ type: 'text', id: 'p', content: 'x', model: 'gemini-3.8-flash' }] }]);
    expect(items[0]).toMatchObject({ kind: 'text', model: 'gemini-3.8-flash' });
  });
});
