import { LIMITS } from './truncate.js';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/pre)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e.startsWith('#x') || e.startsWith('#X')) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** Fetch a URL with the native fetch API (no shell involved). */
export async function webFetch(
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<{ content: string; statusCode: number; contentType: string; truncated: boolean }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`URL invalide : ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Protocole non autorisé : ${parsed.protocol}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(parsed, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Fuller/0.3 (+https://github.com/fuller-code)', accept: 'text/html,application/json,text/plain,*/*' },
    });
    const contentType = res.headers.get('content-type') ?? '';
    const raw = await res.text();
    const text = /html/i.test(contentType) ? htmlToText(raw) : raw;
    const truncated = text.length > LIMITS.webChars;
    return { content: truncated ? text.slice(0, LIMITS.webChars) + '\n… [truncated]' : text, statusCode: res.status, contentType, truncated };
  } catch (err: any) {
    if (controller.signal.aborted) throw new Error(options.signal?.aborted ? 'Interrupted' : `Timeout en récupérant ${url}`);
    throw new Error(`Échec de récupération de ${url}: ${err.message || String(err)}`);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
