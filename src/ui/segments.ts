/**
 * Coloured pieces inside a system message, as Claude Code draws them
 * ("Set model to <model in the permission colour>"): `{{permission:text}}`
 * marks a segment with a theme colour name. Everything else keeps the
 * message's own colour.
 */
export interface Segment {
  text: string;
  /** Theme colour name (permission, success, warning, error, subtle, text). */
  color?: string;
}

const MARK = /\{\{(\w+):([^}]*)\}\}/g;

export function colored(color: string, text: string): string {
  return `{{${color}:${text.replace(/\}\}/g, '} }')}}}`;
}

export function parseSegments(content: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of content.matchAll(MARK)) {
    if (match.index! > last) out.push({ text: content.slice(last, match.index) });
    out.push({ text: match[2], color: match[1] });
    last = match.index! + match[0].length;
  }
  if (last < content.length) out.push({ text: content.slice(last) });
  return out;
}

/** The message without its colour marks, for text exports. */
export function stripSegments(content: string): string {
  return content.replace(MARK, '$2');
}
