import type { ModelUsage } from './keyPool.js';
import type { QuotaExhaustedError } from './gemini.js';
import { modelLabel } from '../ui/modelLabel.js';

/** "13h 04m", "12m", "45s": time left before a quota comes back. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** One bar for a model across every key: "████████░░░░". */
export function quotaBar(fraction: number, width = 20): string {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** "60% used · resets in 2h 10m" (the keys stay out of sight; refused keys are mentioned once). */
export function usageSummary(usage: ModelUsage, now = Date.now()): string {
  const parts = [`${Math.round(usage.usedFraction * 100)}% used`];
  if (usage.resetsAt && usage.exhausted) parts.push(`resets in ${formatDuration(usage.resetsAt - now)}`);
  if (usage.overloaded) parts.push('overloaded');
  if (usage.refused) parts.push(`${usage.refused} key${usage.refused === 1 ? '' : 's'} refused`);
  return parts.join(' · ');
}

/** The message that ends a turn when the model cannot be used and no fallback was accepted. */
export function quotaMessage(err: QuotaExhaustedError, now = Date.now()): string {
  const name = modelLabel(err.model);
  if (err.reason === 'overloaded') return `${name} is overloaded (high demand). Try again in a few minutes, or /model to switch models.`;
  if (err.reason === 'context') return `This conversation is too long for ${name}. Run /compact, then send your message again.`;
  const reset = err.usage.resetsAt ? ` Access resets in ${formatDuration(err.usage.resetsAt - now)}.` : '';
  return `Usage limit reached for ${name}.${reset}\n/model to switch models · /status for usage.`;
}
