import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { SpinnerLine, lighten, thinkingTier } from '../src/ui/Spinner.js';
import { Footer } from '../src/ui/Footer.js';
import { turnEndLine } from '../src/ui/viewerText.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import { SPINNER_FRAMES } from '../src/branding.js';

const wrap = (node: React.ReactNode) => <ThemeProvider theme={loadTheme('dark')}>{node}</ThemeProvider>;

describe('waiting animation (Claude Code 2.1.281)', () => {
  it('shows glyph and verb only, then the timer and what the model does after five seconds', () => {
    const early = render(wrap(<SpinnerLine status="thinking" startedAt={Date.now()} responseTokens={0} verbs={['Mulling']} frame="✶" />));
    expect(early.lastFrame()).toBe('✶ Mulling…');
    early.unmount();
    const later = render(wrap(<SpinnerLine status="thinking" startedAt={Date.now() - 6_000} responseTokens={0} verbs={['Mulling']} frame="✶" />));
    return new Promise<void>((resolve) => setTimeout(() => {
      expect(later.lastFrame()).toBe('✶ Mulling… (6s · thinking)');
      later.unmount();
      resolve();
    }, 600));
  });

  it('names the thinking tiers like Claude Code 2.1.282 (10, 20, 30, 45 s), as the detail and not the verb', () => {
    expect([0, 9, 10, 19, 20, 30, 44, 45, 600].map(thinkingTier)).toEqual(['thinking', 'thinking', 'still thinking', 'still thinking', 'thinking more', 'thinking some more', 'thinking some more', 'deep in thought', 'deep in thought']);
  });

  it('uses Claude Code glyphs and a lighter glint derived from the accent', () => {
    expect(SPINNER_FRAMES).toEqual(['·', '✢', '*', '✶', '✻', '✽', '✻', '✶', '*', '✢']);
    expect(lighten('#d4a04c')).toBe('#e7cb9d');
    expect(lighten('yellow')).toBe('yellowBright');
  });

  it('ends a turn with "✻ <verb> for <duration> · done <time>", skipping short turns', () => {
    const at = new Date(2026, 8, 24, 3, 20).getTime();
    expect(turnEndLine({ key: 't1', durationMs: 14_000, toolCount: 0, timestamp: at })).toMatch(/^✻ [A-Z][a-z]+ for 14s · done 3:20 AM$/);
    expect(turnEndLine({ key: 't2', durationMs: 1_000, toolCount: 0, timestamp: at })).toBeNull();
  });

  it('keeps the mode in the footer with "esc to interrupt" while busy, and hides the context until 80 % used', () => {
    const usage = (promptTokens: number) => ({ promptTokens, responseTokens: 0, cumulativeTokens: 0, contextWindow: 100_000, apiCalls: 1, turns: 1 });
    const busy = render(wrap(<Footer mode="default" status="thinking" usage={usage(1000)} autoCompactThreshold={0.85} inputEmpty bashMode={false} />));
    expect(busy.lastFrame()?.trimEnd()).toBe('  ⏸ manual mode on · esc to interrupt · ← for agents');
    busy.unmount();
    const full = render(wrap(<Footer mode="default" status="idle" usage={usage(75_000)} autoCompactThreshold={0.85} inputEmpty bashMode={false} />));
    expect(full.lastFrame()).toContain('Context left until auto-compact: 12%');
    full.unmount();
  });
});

describe('task panel (Claude Code 2.1.282 glyphs and header, read in its binary)', () => {
  it('heads the list with the counts and uses ✔ ◼ ◻', async () => {
    const { todoHeader, todoGlyph } = await import('../src/ui/TodoPanel.js');
    const todos = [
      { content: 'a', status: 'completed' as const }, { content: 'b', status: 'completed' as const },
      { content: 'c', status: 'in_progress' as const }, { content: 'd', status: 'pending' as const }, { content: 'e', status: 'pending' as const },
    ];
    expect(todoHeader(todos)).toBe('5 tasks (2 done, 1 in progress, 2 open)');
    expect(todoHeader([todos[3]])).toBe('1 task (0 done, 0 in progress, 1 open)');
    expect(['completed', 'in_progress', 'pending'].map((s) => todoGlyph(s as any))).toEqual(['✔', '◼', '◻']);
  });
});
