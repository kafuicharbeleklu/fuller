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

  it('keeps the mode in the footer with "esc to interrupt" while busy, and shows the context only near the limit', () => {
    const usage = (promptTokens: number) => ({ promptTokens, responseTokens: 0, cumulativeTokens: 0, contextWindow: 100_000, apiCalls: 1, turns: 1 });
    const busy = render(wrap(<Footer mode="default" status="thinking" usage={usage(1000)} autoCompactThreshold={0.85} inputEmpty bashMode={false} />));
    expect(busy.lastFrame()?.trimEnd()).toBe('  ⏸ manual mode on · esc to interrupt · ← for agents');
    busy.unmount();
    const full = render(wrap(<Footer mode="default" status="idle" usage={usage(75_000)} autoCompactThreshold={0.85} inputEmpty bashMode={false} />));
    expect(full.lastFrame()).toContain('12% until auto-compact');
    full.unmount();
  });

  it('counts down to auto-compact only in the last 20,000 tokens, as Claude Code 2.1.283 does', async () => {
    const { contextLabel } = await import('../src/ui/Footer.js');
    const usage = (promptTokens: number, compactAt?: number) => ({ promptTokens, responseTokens: 0, cumulativeTokens: 0, contextWindow: 1_000_000, apiCalls: 1, turns: 1, compactAt });
    // Gemini: a 1M window compacted at 85 %, i.e. 850,000 tokens.
    expect(contextLabel(usage(829_000), true, 0.85)).toBeNull();
    expect(contextLabel(usage(830_000), true, 0.85)).toEqual({ text: '2% until auto-compact', low: false });
    // The loop's real compaction point wins (a smaller model in the fallback chain).
    expect(contextLabel(usage(190_000, 200_000), true, 0.85)).toEqual({ text: '5% until auto-compact', low: false });
    // Auto-compact off: red, against the whole window.
    expect(contextLabel(usage(990_000), false, 0.85)).toEqual({ text: 'Context low (1% remaining) · Run /compact to compact & continue', low: true });
    expect(contextLabel(usage(900_000), false, 0.85)).toBeNull();
    expect(contextLabel(usage(0), true, 0.85)).toBeNull();
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
