import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { TranscriptItemView } from '../src/ui/Transcript.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import { transcriptLines } from '../src/ui/viewerText.js';
import { messagesToTranscript } from '../src/agent/transcript.js';

const item = { key: 't', kind: 'thinking' as const, messageId: 'm', content: '**Reading the file**\nThe bug is in the loop bound.', timestamp: 0 };
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('thought summaries in the transcript (Claude Code: ✻ Thinking…)', () => {
  it('shows one folded line by default, and the summary without Markdown markers in the detailed view', () => {
    const folded = render(<ThemeProvider theme={loadTheme('dark')}><TranscriptItemView item={item} verbose={false} /></ThemeProvider>);
    expect(plain(folded.lastFrame() || '').trim()).toBe('✻ Thinking…');
    folded.unmount();
    const open = render(<ThemeProvider theme={loadTheme('dark')}><TranscriptItemView item={item} verbose /></ThemeProvider>);
    const frame = plain(open.lastFrame() || '');
    expect(frame).toContain('✻ Thinking…');
    expect(frame).toContain('Reading the file');
    expect(frame).not.toContain('**');
    expect(frame).toContain('The bug is in the loop bound.');
    open.unmount();
  });

  it('appears in the Ctrl+O viewer and comes back when a session is restored', () => {
    const lines = transcriptLines([item], true);
    expect(lines).toContain('✻ Thinking…');
    expect(lines).toContain('  Reading the file');
    const restored = messagesToTranscript([{ id: 'm', role: 'assistant', content: 'x', timestamp: 0, parts: [{ type: 'thinking', id: 'p', content: 'why' }, { type: 'text', id: 'q', content: 'x' }] }] as any);
    expect(restored.map((i) => i.kind)).toEqual(['thinking', 'text']);
  });
});
