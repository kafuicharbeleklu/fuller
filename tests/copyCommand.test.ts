import { describe, expect, it, vi, beforeEach } from 'vitest';

const copied: string[] = [];
vi.mock('../src/utils/clipboard.js', () => ({ copyToClipboard: async (text: string) => { copied.push(text); return 'test'; } }));
vi.mock('../src/config.js', async (original) => ({ ...await original<typeof import('../src/config.js')>(), saveUserSetting: () => '' }));

import { runCommand, codeBlocks, fileExtension } from '../src/ui/commands.js';

const reply = 'Here is the fix:\n\n```python\ndef add(a, b):\n    return a + b\n```\n\nAnd the test:\n\n```\nassert add(1, 2) == 3\n```\n';
function ctx(messages: string[], settings: Record<string, unknown> = {}) {
  const said: string[] = [];
  const dialogs: any[] = [];
  const context = {
    agent: { getMessages: () => messages.map((content, i) => ({ id: String(i), role: 'assistant', content, timestamp: i })) },
    config: { settings },
    addSystem: (t: string) => said.push(t),
    openDialog: (d: any) => dialogs.push(d),
  } as any;
  return { context, said, dialogs };
}
const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => { copied.length = 0; });

describe('/copy (Claude Code 2.1.282, read in its binary)', () => {
  it('finds the code blocks and names their files', () => {
    expect(codeBlocks(reply)).toEqual([{ code: 'def add(a, b):\n    return a + b', lang: 'python' }, { code: 'assert add(1, 2) == 3', lang: undefined }]);
    expect(fileExtension('python')).toBe('.python');
    expect(fileExtension(undefined)).toBe('.txt');
    expect(fileExtension('plaintext')).toBe('.txt');
  });

  it('copies at once when there is no code block, and says where the file is', async () => {
    const { context, said } = ctx(['Just prose.']);
    await runCommand('/copy', context);
    expect(copied).toEqual(['Just prose.']);
    expect(said[0]).toMatch(/^Copied to clipboard \(11 characters, 1 lines\)\nAlso written to .*response\.md$/);
  });

  it('offers the full response, each block and "Always copy full response"; Enter copies, w writes', async () => {
    const { context, said, dialogs } = ctx([reply]);
    await runCommand('/copy', context);
    const d = dialogs[0];
    expect(d.header).toEqual(['Select content to copy:']);
    expect(d.hint).toBe('Enter to copy · w to write to file · Esc to cancel');
    expect(d.items.map((i: any) => i.label)).toEqual(['Full response', 'def add(a, b): return a + b', 'assert add(1, 2) == 3', 'Always copy full response']);
    expect(d.items[0].hint).toBe(`${reply.length} chars, ${reply.split('\n').length} lines`);
    expect(d.items[1].hint).toBe('python, 2 lines');
    expect(d.items[3].hint).toBe('Skip this picker in the future (revert via /config)');
    d.items[1].onSelect(); await flush();
    expect(copied).toEqual(['def add(a, b):\n    return a + b']);
    expect(said.at(-1)).toMatch(/Also written to .*copy\.python$/);
    d.items[2].onShortcut(); await flush();
    expect(copied).toHaveLength(1);
    expect(said.at(-1)).toMatch(/^Written to .*copy\.txt$/);
  });

  it('remembers "Always copy full response" and skips the picker afterwards', async () => {
    const settings: Record<string, unknown> = {};
    const { context, said, dialogs } = ctx([reply], settings);
    await runCommand('/copy', context);
    dialogs[0].items[3].onSelect(); await flush();
    expect(settings.copyFullResponse).toBe(true);
    expect(said.at(-1)).toContain('Preference saved. Use /config to change copyFullResponse');
    await runCommand('/copy', context);
    expect(dialogs).toHaveLength(1);
    expect(copied.at(-1)).toBe(reply);
  });

  it('checks N like Claude Code', async () => {
    const { context, said } = ctx(['one', 'two']);
    await runCommand('/copy 2', context);
    expect(copied).toEqual(['one']);
    await runCommand('/copy 3', context);
    expect(said.at(-1)).toBe('Only 2 assistant messages available to copy');
    await runCommand('/copy x', context);
    expect(said.at(-1)).toBe('Usage: /copy [N] where N is 1 (latest), 2, 3, … Got: x');
  });
});
