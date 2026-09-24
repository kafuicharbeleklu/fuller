const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function previousGrapheme(text: string, cursor: number): number {
  let previous = 0;
  for (const part of segmenter.segment(text)) {
    if (part.index >= cursor) break;
    previous = part.index;
  }
  return previous;
}

export function nextGrapheme(text: string, cursor: number): number {
  for (const part of segmenter.segment(text)) {
    if (part.index >= cursor) return part.index + part.segment.length;
    if (part.index + part.segment.length > cursor) return part.index + part.segment.length;
  }
  return text.length;
}

const words = new Intl.Segmenter(undefined, { granularity: 'word' });

function wordRanges(text: string): Array<{ start: number; end: number }> {
  return [...words.segment(text)].flatMap((part) =>
    [...part.segment.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)].map((match) => ({
      start: part.index + match.index,
      end: part.index + match.index + match[0].length,
    })));
}

export function previousWord(text: string, cursor: number): number {
  return wordRanges(text).filter((word) => word.start < cursor).at(-1)?.start ?? 0;
}

export function nextWord(text: string, cursor: number): number {
  return wordRanges(text).find((word) => word.end > cursor)?.end ?? text.length;
}

export function previousWhitespaceWord(text: string, cursor: number): number {
  return text.slice(0, cursor).replace(/\S+\s*$/u, '').length;
}

// Preserve joiners used by Indic scripts and emoji, plus emoji variation selectors.
const HIDDEN_CONTROLS = /[\u200B\u200E-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u{E0001}\u{E0020}-\u{E007F}]/gu;

export function sanitizePrompt(text: string): { text: string; removed: number } {
  let removed = 0;
  const cleaned = text.replace(HIDDEN_CONTROLS, () => { removed++; return ''; });
  return { text: cleaned, removed };
}
