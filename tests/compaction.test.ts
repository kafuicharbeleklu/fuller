import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Content } from '@google/genai';

let mockGenerateContent: ReturnType<typeof vi.fn>;

vi.mock('@google/genai', async (importOriginal) => {
  const real: any = await importOriginal();
  class GoogleGenAI {
    chats = {
      create: () => ({
        getHistory: () => [],
        sendMessageStream: async () => (async function* () {
          yield { candidates: [{ content: { parts: [{ text: 'ok' }] } }] };
        })(),
      }),
    };
    models = {
      generateContent: (...args: any[]) => mockGenerateContent(...args),
    };
  }
  return { ...real, GoogleGenAI };
});

import {
  GeminiAgentSession,
  extractUserMessagesFromHistory,
  formatUserMessagesVerbatim,
} from '../src/agent/gemini.js';
import { getConfig } from '../src/config.js';

describe('compaction helper functions', () => {
  it('extracts typed user messages from Content[] history, ignoring tool responses and internal markers', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Please do not touch tests/' }] },
      { role: 'model', parts: [{ functionCall: { id: 'c1', name: 'read_file', args: { file_path: 'src/index.ts' } } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'c1', name: 'read_file', response: { output: 'console.log("hello");' } } }] },
      { role: 'model', parts: [{ text: 'Read file complete.' }] },
      { role: 'user', parts: [{ text: 'Now fix the bug in src/agent/gemini.ts' }] },
      { role: 'user', parts: [{ text: '[Conversation summary]\nprevious summary' }] },
      { role: 'user', parts: [{ text: '[Stop hook feedback] check again' }] },
    ];

    const messages = extractUserMessagesFromHistory(history);
    expect(messages).toEqual([
      'Please do not touch tests/',
      'Now fix the bug in src/agent/gemini.ts',
    ]);
  });

  it('never takes the lines of a multi-line tool output for user messages (review of the real session, 26/09)', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'fix the bug, do not touch tests/' }] },
      { role: 'model', parts: [{ functionCall: { id: 'c1', name: 'read_file', args: { file_path: 'a.ts' } } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'c1', name: 'read_file', response: { output: 'line one\nconst secret = 1;\nline three' } } }] },
    ];
    expect(extractUserMessagesFromHistory(history)).toEqual(['fix the bug, do not touch tests/']);
  });

  it('formats verbatim user messages oldest first under "User messages (verbatim)"', () => {
    const messages = ['Instruction 1', 'Instruction 2: do not touch tests/'];
    const formatted = formatUserMessagesVerbatim(messages, 12000);
    expect(formatted).toBe(`User messages (verbatim)\n- Instruction 1\n- Instruction 2: do not touch tests/`);
  });

  it('handles empty user messages gracefully', () => {
    const formatted = formatUserMessagesVerbatim([], 12000);
    expect(formatted).toBe('User messages (verbatim)\n(no user messages)');
  });

  it('keeps the first and the latest messages whole and shortens those in between, saying so (Codex, C009)', () => {
    // Codex's reproduction: the task and its limits, then a long complement, then "continue".
    const task = 'Clean up the temporary folders left by the tests.\n1. Find which tests leave folders in /tmp.\n2. Make them remove their folders.\n3. Do not touch src/ and do not delete the directories that already exist in /tmp.\n' + 'Context. '.repeat(150);
    const messages = [task, 'Additional details. '.repeat(580), 'continue'];
    // The default budget holds them all, word for word.
    expect(formatUserMessagesVerbatim(messages)).toBe(`User messages (verbatim)\n${messages.map((m) => `- ${m}`).join('\n')}`);
    const formatted = formatUserMessagesVerbatim(messages, 4000);
    expect(formatted.length).toBeLessThanOrEqual(4000);
    expect(formatted).toContain('do not delete the directories that already exist in /tmp');
    expect(formatted).toContain(`- ${task}\n`);
    expect(formatted.endsWith('- continue')).toBe(true);
    expect(formatted).toContain('were shortened where marked "characters left out"');
    expect(formatted).toMatch(/Additional details\. .* … \[\d+ characters left out\] … .*Additional details\./);
  });

  it('never cuts the first or the latest message, even over the budget', () => {
    const first = 'F'.repeat(3000);
    const latest = 'L'.repeat(3000);
    const formatted = formatUserMessagesVerbatim([first, 'M'.repeat(3000), latest], 2000);
    expect(formatted).toContain(first);
    expect(formatted).toContain(latest);
    expect(formatted).toContain('characters left out');
  });
});

describe('GeminiAgentSession.compactHistory', () => {
  let session: GeminiAgentSession;

  beforeEach(() => {
    mockGenerateContent = vi.fn();
    session = new GeminiAgentSession({
      ...getConfig({ workspaceDir: process.cwd(), apiKey: 'test-key', model: 'gemini-3.6-flash' }),
      apiKeys: ['test-key'],
    } as any);
  });

  it('performs two passes: summary then omission check, and appends omissions and verbatim user messages', async () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'do not touch tests/' }] },
      { role: 'model', parts: [{ text: 'Working on it' }] },
      { role: 'user', parts: [{ text: 'Refactor gemini.ts' }] },
    ];

    mockGenerateContent
      // First pass: base summary
      .mockResolvedValueOnce({
        text: '### 1. Task and user intent\nRefactor gemini.ts.\n### 2. Current state\nIn progress.',
      })
      // Second pass: omission check finds missing open error / constraint
      .mockResolvedValueOnce({
        text: '- Open error in compilation\n- Explicit user constraint: do not touch tests/',
      });

    const result = await session.compactHistory(history, 'refactoring focus');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);

    // Verify first prompt received the focus argument
    const firstPrompt = mockGenerateContent.mock.calls[0][0].contents;
    expect(firstPrompt).toContain('Pay special attention to: refactoring focus');
    expect(firstPrompt).toContain('do not touch tests/');

    // Verify second prompt checked omissions against summary & history
    const secondPrompt = mockGenerateContent.mock.calls[1][0].contents;
    expect(secondPrompt).toContain('Compare this summary of a coding-agent conversation');
    expect(secondPrompt).toContain('Refactor gemini.ts.');

    // Verify final result combines summary, omissions, and verbatim section
    expect(result).toContain('### 1. Task and user intent');
    expect(result).toContain('### Additional context (omissions check)');
    expect(result).toContain('- Open error in compilation');
    expect(result).toContain('User messages (verbatim)');
    expect(result).toContain('- do not touch tests/');
    expect(result).toContain('- Refactor gemini.ts');
  });

  it('does not append omissions section when the second pass returns NONE', async () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ text: 'Hi' }] },
    ];

    mockGenerateContent
      .mockResolvedValueOnce({
        text: 'Summary is full and complete.',
      })
      .mockResolvedValueOnce({
        text: 'NONE',
      });

    const result = await session.compactHistory(history);

    expect(result).not.toContain('### Additional context (omissions check)');
    expect(result).toContain('Summary is full and complete.');
    expect(result).toContain('User messages (verbatim)');
    expect(result).toContain('- Hello');
  });

  it('keeps the summary without failing if the second pass throws', async () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Fix bug' }] },
      { role: 'model', parts: [{ text: 'Fixed' }] },
    ];

    mockGenerateContent
      .mockResolvedValueOnce({
        text: 'Summary of fix.',
      })
      .mockRejectedValueOnce(new Error('Second pass rate limit or network error'));

    const result = await session.compactHistory(history);

    expect(result).toContain('Summary of fix.');
    expect(result).not.toContain('### Additional context (omissions check)');
    expect(result).toContain('User messages (verbatim)');
    expect(result).toContain('- Fix bug');
  });

  it('uses the messages the user typed when given, not the text injected into the history', async () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'Refactor @src/a.ts\n\n<file path="src/a.ts">\nexport const a = 1;\n</file>' }] },
      { role: 'model', parts: [{ text: 'Done' }] },
    ];
    mockGenerateContent.mockResolvedValueOnce({ text: 'Summary.' }).mockResolvedValueOnce({ text: 'NONE' });
    const result = await session.compactHistory(history, undefined, undefined, ['Refactor @src/a.ts']);
    expect(result).toContain('- Refactor @src/a.ts');
    expect(result).not.toContain('export const a = 1;');
  });
});
