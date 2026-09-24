import { SPINNER_PAST_VERBS } from '../branding.js';
import fs from 'node:fs';
import stripAnsi from 'strip-ansi';
import type { TranscriptItem, ToolCallState } from '../agent/types.js';

import { toolLabel, toolArgSummary } from '../tools/registry.js';
import { stripSegments } from './segments.js';

const MAX_INLINE_OUTPUT = 10 * 1024 * 1024;

function safeText(value: string): string {
  return stripAnsi(value).replace(/\r/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

function resultText(tool: ToolCallState, detailed: boolean): string {
  if (detailed) {
    if (tool.outputFile) {
      try {
        const size = fs.statSync(tool.outputFile).size;
        if (size > MAX_INLINE_OUTPUT) return `Full output saved to ${tool.outputFile} (${size} bytes). Open it with less or your editor.`;
        return fs.readFileSync(tool.outputFile, 'utf8') || '(no output)';
      } catch { /* Fall back to the stored result. */ }
    }
    if (tool.diff) return tool.diff;
    return tool.result || tool.error || tool.summary || 'Done';
  }
  return tool.summary || tool.result || tool.error || 'Done';
}

export function transcriptLines(items: TranscriptItem[], detailed: boolean): string[] {
  const lines: string[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.kind === 'banner') continue;
    if (item.kind === 'user') {
      lines.push(`❯ ${safeText(item.message.content)}`);
      const next = items[index + 1];
      if (!(item.message.kind === 'command' && next?.kind === 'system' && next.message.kind === 'notice')) lines.push('');
    }
    else if (item.kind === 'text') lines.push(`● ${new Date(item.timestamp).toLocaleTimeString()}  ${safeText(item.content)}`, '');
    else if (item.kind === 'system' && item.message.kind === 'context') lines.push('  ⎿ Context Usage (see /context)', '');
    else if (item.kind === 'system') lines.push(`${item.message.kind === 'notice' ? '  ⎿' : '※'} ${safeText(stripSegments(item.message.content))}`, '');
    else if (item.kind === 'tool') {
      const tool = item.toolCall;
      const label = toolLabel(tool.name);
      let header: string;
      if (tool.name === 'execute_bash') {
        const cmd = String(tool.args.command ?? '').trim();
        const desc = tool.args.description ? ` — ${tool.args.description}` : '';
        header = `● ${label}(${safeText(cmd)})${safeText(desc)}`;
      } else {
        const arg = toolArgSummary(tool.name, tool.args);
        header = `● ${label}(${safeText(arg)})`;
      }
      if (tool.summary && detailed) {
        header += `  [${tool.summary}]`;
      }
      lines.push(header);
      const result = safeText(resultText(tool, detailed));
      for (const row of result.split('\n')) lines.push(`  ⎿ ${row}`);
      lines.push('');
    } else if (item.kind === 'turn_end') { const line = turnEndLine(item); if (line) lines.push(line, ''); }
  }
  return lines.flatMap((line) => line.split('\n'));
}

/**
 * End-of-turn line as Claude Code writes it: "✻ Churned for 14s · done 3:20 AM".
 * Short turns without tools get none. The verb is stable for a given turn.
 */
export function turnEndLine(item: { durationMs: number; toolCount: number; timestamp: number; key: string }): string | null {
  if (item.durationMs < 3000 && item.toolCount === 0) return null;
  const secs = Math.round(item.durationMs / 1000);
  const duration = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
  const hash = [...item.key].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const verb = SPINNER_PAST_VERBS[hash % SPINNER_PAST_VERBS.length];
  const done = new Date(item.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `✻ ${verb} for ${duration} · done ${done}`;
}
