import React, { useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';
import { modelLabel } from './modelLabel.js';
import type { SessionMeta } from '../session/store.js';

export type StatsRange = 'all' | '7d' | '30d';
const RANGES: Array<{ key: StatsRange; label: string; days?: number }> = [
  { key: 'all', label: 'All time' }, { key: '7d', label: 'Last 7 days', days: 7 }, { key: '30d', label: 'Last 30 days', days: 30 },
];
const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Roughly the tokens in The Lord of the Rings, Claude Code's yardstick. */
const LOTR_TOKENS = 576_000;

const dayKey = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const startOfDay = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function shortTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}b`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}m`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function duration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  return [d ? `${d}d` : '', h ? `${h}h` : '', `${min}m`].filter(Boolean).join(' ');
}

export interface Stats {
  favoriteModel?: string;
  totalTokens: number;
  sessions: number;
  longestSession: number;
  activeDays: number;
  spanDays: number;
  longestStreak: number;
  currentStreak: number;
  mostActiveDay?: number;
  /** Prompts per day, by dayKey. */
  perDay: Map<string, number>;
  models: Array<{ model: string; sessions: number; tokens: number }>;
}

/** /stats from Fuller's own records: stored sessions and the prompt history. */
export function computeStats(sessions: SessionMeta[], prompts: number[], range: StatsRange, now = Date.now()): Stats {
  const days = RANGES.find((r) => r.key === range)?.days;
  const since = days ? startOfDay(now) - (days - 1) * DAY : 0;
  const inRange = sessions.filter((s) => s.updatedAt >= since);
  const times = [...prompts.filter((t) => t >= since), ...inRange.map((s) => s.createdAt)];
  const perDay = new Map<string, number>();
  for (const t of prompts.filter((t) => t >= since)) perDay.set(dayKey(t), (perDay.get(dayKey(t)) ?? 0) + 1);
  for (const s of inRange) if (!perDay.has(dayKey(s.createdAt))) perDay.set(dayKey(s.createdAt), 1);
  const byModel = new Map<string, { sessions: number; tokens: number }>();
  for (const s of inRange) {
    const m = byModel.get(s.model) ?? { sessions: 0, tokens: 0 };
    byModel.set(s.model, { sessions: m.sessions + 1, tokens: m.tokens + (s.tokenCount || 0) });
  }
  const models = [...byModel.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.tokens - a.tokens || b.sessions - a.sessions);
  // Streaks over consecutive active days.
  const first = times.length ? startOfDay(Math.min(...times)) : startOfDay(now);
  let longestStreak = 0, run = 0;
  for (let t = first; t <= startOfDay(now); t += DAY) {
    run = perDay.has(dayKey(t)) ? run + 1 : 0;
    longestStreak = Math.max(longestStreak, run);
  }
  let currentStreak = 0;
  for (let t = startOfDay(now); perDay.has(dayKey(t)); t -= DAY) currentStreak++;
  let mostActiveDay: number | undefined, most = 0;
  for (let t = first; t <= startOfDay(now); t += DAY) { const n = perDay.get(dayKey(t)) ?? 0; if (n > most) { most = n; mostActiveDay = t; } }
  return {
    favoriteModel: models[0]?.model,
    totalTokens: inRange.reduce((sum, s) => sum + (s.tokenCount || 0), 0),
    sessions: inRange.length,
    longestSession: Math.max(0, ...inRange.map((s) => s.updatedAt - s.createdAt)),
    activeDays: perDay.size,
    spanDays: times.length ? Math.floor((startOfDay(now) - first) / DAY) + 1 : 0,
    longestStreak,
    currentStreak,
    mostActiveDay,
    perDay,
    models,
  };
}

/** The year of activity: one column per week, Sunday on top, as Claude Code draws it. */
function Heatmap({ perDay, now, weeks }: { perDay: Map<string, number>; now: number; weeks: number }) {
  const theme = useTheme();
  const today = new Date(startOfDay(now));
  const lastSunday = startOfDay(now) - today.getDay() * DAY;
  const start = lastSunday - (weeks - 1) * 7 * DAY;
  const max = Math.max(1, ...perDay.values());
  const cell = (t: number) => {
    if (t > startOfDay(now)) return ' ';
    const n = perDay.get(dayKey(t)) ?? 0;
    if (!n) return null;
    return ['░', '▒', '▓', '█'][Math.min(3, Math.floor((n / max) * 4 - 1e-9))];
  };
  let months = '';
  for (let w = 0; w < weeks; w++) {
    const d = new Date(start + w * 7 * DAY);
    if (d.getDate() <= 7 && months.length <= w) months = months.padEnd(w) + MONTHS[d.getMonth()];
  }
  const labels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
  return (
    <Box flexDirection="column">
      <Text>{'    '}{months.slice(0, weeks)}</Text>
      {labels.map((label, day) => (
        <Text key={day}>
          {label.padEnd(4)}
          {Array.from({ length: weeks }, (_, w) => {
            const c = cell(start + (w * 7 + day) * DAY);
            return c === null ? <Text key={w} color={theme.subtle}>·</Text> : <Text key={w} color={theme.accent}>{c}</Text>;
          })}
        </Text>
      ))}
      <Text>{'    '}Less <Text color={theme.accent}>░ ▒ ▓ █</Text> More</Text>
    </Box>
  );
}

interface Props {
  load: () => { sessions: SessionMeta[]; prompts: number[] };
  width: number;
  now?: number;
}

/**
 * Settings → Stats, after Claude Code 2.1.281: Overview (activity map, range,
 * favourite model, tokens, sessions, streaks) and Models. v switches the
 * view, r the range. Fuller counts tokens per session, without an input and
 * output breakdown.
 */
export const StatsView: React.FC<Props> = ({ load, width, now = Date.now() }) => {
  const theme = useTheme();
  const [view, setView] = useState<'overview' | 'models'>('overview');
  const [range, setRange] = useState<StatsRange>('all');
  const data = useMemo(load, [load]);
  const stats = useMemo(() => computeStats(data.sessions, data.prompts, range, now), [data, range, now]);
  useRawInput((e) => {
    if (e.name === 'char' && e.text === 'v' && !e.ctrl) setView((v) => (v === 'overview' ? 'models' : 'overview'));
    else if (e.name === 'char' && e.text === 'r' && !e.ctrl) setRange((r) => RANGES[(RANGES.findIndex((x) => x.key === r) + 1) % RANGES.length].key);
  });
  const col = 26;
  const pair = (a: React.ReactNode, aw: number, b: React.ReactNode) => <Text>{a}{' '.repeat(Math.max(1, col - aw))}{b}</Text>;
  const value = (v: string, bold = false) => <Text color={theme.accent} bold={bold}>{v}</Text>;
  const tabs = (
    <Text>{' '}{view === 'overview' ? <Text bold inverse>Overview</Text> : 'Overview'}{'   '}{view === 'models' ? <Text bold inverse>Models</Text> : 'Models'}</Text>
  );
  const ranges = (
    <Text>{RANGES.map((r, i) => <Text key={r.key}>{i ? <Text color={theme.subtle}> · </Text> : null}{r.key === range ? <Text color={theme.accent} bold>{r.label}</Text> : <Text color={theme.subtle}>{r.label}</Text>}</Text>)}</Text>
  );
  if (!data.sessions.length && !data.prompts.length) {
    return <Box flexDirection="column">{tabs}<Text color={theme.subtle}>No sessions yet. Stats appear after your first conversation.</Text></Box>;
  }
  if (view === 'models') {
    return (
      <Box flexDirection="column">
        {tabs}
        {ranges}
        {stats.models.map((m) => (
          <Text key={m.model}>{modelLabel(m.model).padEnd(col)}{value(shortTokens(m.tokens))} tokens<Text color={theme.subtle}> · {m.sessions} session{m.sessions === 1 ? '' : 's'}</Text></Text>
        ))}
        <Text color={theme.subtle}>v to switch view · r to change range · Esc to cancel</Text>
      </Box>
    );
  }
  const favorite = stats.favoriteModel ? modelLabel(stats.favoriteModel) : '—';
  const mostActive = stats.mostActiveDay ? `${MONTHS[new Date(stats.mostActiveDay).getMonth()]} ${new Date(stats.mostActiveDay).getDate()}` : '—';
  const ratio = stats.totalTokens / LOTR_TOKENS;
  return (
    <Box flexDirection="column">
      {tabs}
      <Heatmap perDay={computeStats(data.sessions, data.prompts, 'all', now).perDay} now={now} weeks={Math.max(8, Math.min(53, width - 12))} />
      {ranges}
      {pair(<Text>Favorite model: {value(favorite, true)}</Text>, 16 + favorite.length, <Text>Total tokens: {value(shortTokens(stats.totalTokens))}</Text>)}
      {pair(<Text>Sessions: {value(String(stats.sessions))}</Text>, 10 + String(stats.sessions).length, <Text>Longest session: {value(duration(stats.longestSession))}</Text>)}
      {pair(<Text>Active days: {value(String(stats.activeDays))}<Text color={theme.userPrompt ?? theme.subtle}>/{stats.spanDays}</Text></Text>, 13 + String(stats.activeDays).length + 1 + String(stats.spanDays).length, <Text>Longest streak: {value(String(stats.longestStreak), true)} days</Text>)}
      {pair(<Text>Most active day: {value(mostActive)}</Text>, 17 + mostActive.length, <Text>Current streak: {value(String(stats.currentStreak), true)} days</Text>)}
      {stats.totalTokens ? <Text color={theme.permission}>{ratio >= 1 ? `Your conversations are ~${Math.round(ratio)}x the tokens in The Lord of the Rings` : `Your conversations are ~${Math.max(1, Math.round(ratio * 100))}% of the tokens in The Lord of the Rings`}</Text> : null}
      <Text color={theme.subtle}>v to switch view · r to change range · Esc to cancel</Text>
    </Box>
  );
};
