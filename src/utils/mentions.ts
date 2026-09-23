import fs from 'node:fs';
import { assertReadable } from '../tools/paths.js';
import { isProbablyBinary, formatBytes } from '../tools/truncate.js';

export interface FileMention {
  raw: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
}

/** Extract `@path` and `@path#L10-30` mentions (not e-mail addresses). */
export function extractMentions(input: string): FileMention[] {
  const pattern = /(?:^|[\s(])@((?:\.{0,2}\/)?[\w./\-]+(?:#L\d+(?:-\d+)?)?)/g;
  const mentions: FileMention[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const full = match[1];
    let filePath = full;
    let startLine: number | undefined;
    let endLine: number | undefined;
    const hash = full.indexOf('#L');
    if (hash !== -1) {
      filePath = full.slice(0, hash);
      const [s, e] = full.slice(hash + 2).split('-');
      startLine = parseInt(s, 10);
      if (e) endLine = parseInt(e, 10);
    }
    filePath = filePath.replace(/[.,;:!?]+$/, '');
    if (!filePath) continue;
    mentions.push({ raw: '@' + full, filePath, startLine, endLine });
  }
  return mentions;
}

const MAX_LINES = 800;

/** Append the content of mentioned files to the prompt (confined to the workspace). */
export function resolveMentions(input: string, workspaceDir: string, extraDirs: string[] = []): string {
  const mentions = extractMentions(input);
  if (mentions.length === 0) return input;
  const seen = new Set<string>();
  let enriched = input;
  for (const m of mentions) {
    if (seen.has(m.raw)) continue;
    seen.add(m.raw);
    let full: string;
    try {
      full = assertReadable(m.filePath, workspaceDir, extraDirs);
    } catch (err: any) {
      enriched += `\n\n[${m.raw}: ${err.message}]`;
      continue;
    }
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(full).slice(0, 200);
        enriched += `\n\n--- Directory: ${m.filePath} ---\n${entries.join('\n')}\n---`;
        continue;
      }
      const buf = fs.readFileSync(full);
      if (isProbablyBinary(buf)) {
        enriched += `\n\n--- File: ${m.filePath} (binary, ${formatBytes(stat.size)}) ---`;
        continue;
      }
      const lines = buf.toString('utf8').split('\n');
      let start = 0;
      let end = lines.length;
      if (m.startLine !== undefined) {
        start = Math.max(0, m.startLine - 1);
        end = m.endLine !== undefined ? Math.min(lines.length, m.endLine) : Math.min(lines.length, start + 1);
        if (m.endLine === undefined) end = Math.min(lines.length, start + 200);
      }
      let truncated = false;
      if (end - start > MAX_LINES) { end = start + MAX_LINES; truncated = true; }
      const width = String(end).length;
      const body = lines.slice(start, end).map((l, i) => `${String(start + i + 1).padStart(width, ' ')}\t${l}`).join('\n');
      enriched += `\n\n--- File: ${m.filePath}${start > 0 || end < lines.length ? ` (lines ${start + 1}-${end} of ${lines.length})` : ''} ---\n${body}${truncated ? '\n… [truncated]' : ''}\n---`;
    } catch (err: any) {
      enriched += `\n\n[${m.raw}: cannot read — ${err.message}]`;
    }
  }
  return enriched;
}
