import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * The system prompt is rebuilt (mode change, /learn…) while a reply is still streaming: the
 * exchange in flight must stay in the history. Real session and SDK, local fake Gemini server.
 */
let server: http.Server | undefined;
afterEach(() => { server?.close(); server = undefined; delete process.env.GOOGLE_GEMINI_BASE_URL; });

function chunk(text: string, finish = false) {
  return `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, ...(finish ? { finishReason: 'STOP' } : {}) }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 } })}\n\n`;
}

describe('rebuilding the chat during a streamed reply', () => {
  it.each([
    ['a mode change or /learn (refresh)', (session: any) => session.refresh()],
    ['/effort (thinking level)', (session: any) => session.setThinkingLevel('low')],
    ['/model (same conversation, new model)', (session: any) => session.switchModel('gemini-3.7-flash')],
    ['nothing (control)', () => {}],
  ])('keeps the exchange in flight after %s', async (_label, rebuild) => {
    let release!: () => void;
    const secondHalf = new Promise<void>((resolve) => { release = resolve; });
    server = http.createServer((req, res) => {
      req.resume();
      req.on('end', async () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(chunk('first half '));
        await secondHalf;
        res.end(chunk('second half', true));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    process.env.GOOGLE_GEMINI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { getConfig } = await import('../src/config.js');
    const { GeminiAgentSession } = await import('../src/agent/gemini.js');
    const config = getConfig({ workspaceDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-stream-')), apiKey: 'fake-key-for-local-server' });
    config.apiKeys = ['fake-key-for-local-server'];
    const session = new GeminiAgentSession(config);
    let streamed = '';
    const turn = session.sendUserMessage('hello', { onChunk: (t) => { streamed += t; if (streamed === 'first half ') { rebuild(session); release(); } } });
    const result = await turn;
    expect(result.text).toBe('first half second half');
    const history = session.getHistory();
    // The SDK records each streamed chunk as its own model content.
    expect(history[0]?.role).toBe('user');
    expect(history.slice(1).every((c) => c.role === 'model')).toBe(true);
    const text = history.slice(1).flatMap((c) => c.parts ?? []).map((p) => p.text ?? '').join('');
    expect(text).toBe('first half second half');
  });
});
