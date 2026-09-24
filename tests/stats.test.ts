import { describe, expect, it } from 'vitest';
import { computeStats, shortTokens } from '../src/ui/StatsView.js';

const DAY = 86_400_000;
const now = new Date(2026, 8, 24, 12).getTime();
const session = (id: string, daysAgo: number, hours: number, tokens: number, model = 'gemini-3.6-flash') => ({
  id, workspaceDir: '/tmp/p', model, createdAt: now - daysAgo * DAY - hours * 3_600_000, updatedAt: now - daysAgo * DAY, messageCount: 2, tokenCount: tokens,
});

describe('/stats', () => {
  it('counts sessions, tokens, active days and streaks', () => {
    const sessions = [session('a', 0, 2, 10_000), session('b', 1, 1, 5_000), session('c', 5, 1, 1_000, 'gemini-3.5-flash')];
    const prompts = [now - 3_600_000, now - DAY, now - DAY - 1000, now - 5 * DAY];
    const all = computeStats(sessions, prompts, 'all', now);
    expect(all.sessions).toBe(3);
    expect(all.totalTokens).toBe(16_000);
    expect(all.favoriteModel).toBe('gemini-3.6-flash');
    expect(all.activeDays).toBe(3);
    expect(all.currentStreak).toBe(2);
    expect(all.longestStreak).toBe(2);
    expect(all.longestSession).toBe(2 * 3_600_000);
    expect(new Date(all.mostActiveDay!).getDate()).toBe(23);
    const week = computeStats(sessions, prompts, '7d', now);
    expect(week.sessions).toBe(3);
    expect(computeStats(sessions, prompts, '7d', now + 3 * DAY).sessions).toBe(2);
  });

  it('writes token counts like Claude Code', () => {
    expect(shortTokens(11_000_000_000)).toBe('11.0b');
    expect(shortTokens(127_500)).toBe('127.5k');
  });
});
