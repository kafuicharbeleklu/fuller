export const LIMITS = {
  bashOutput: 30_000,
  toolResult: 40_000,
  readLines: 2000,
  lineChars: 2000,
  readBytes: 5 * 1024 * 1024,
  searchResults: 200,
  searchOutput: 30_000,
  searchFileBytes: 1024 * 1024,
  webChars: 20_000,
  globFiles: 500,
  listEntries: 300,
} as const;

/** Keep the beginning and the end of a long text, with a marker in the middle. */
export function truncateMiddle(text: string, max: number, headRatio = 0.66): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * headRatio);
  const tail = max - head;
  const dropped = text.length - head - tail;
  return `${text.slice(0, head)}\n\n… [${dropped.toLocaleString('en-US')} characters truncated — output too long] …\n\n${text.slice(-tail)}`;
}

export function truncateHead(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [${(text.length - max).toLocaleString('en-US')} characters truncated]`;
}

export function truncateLines(text: string, maxLines: number): { text: string; hidden: number } {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { text, hidden: 0 };
  return { text: lines.slice(0, maxLines).join('\n'), hidden: lines.length - maxLines };
}

export function isProbablyBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
