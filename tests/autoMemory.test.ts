import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addMemory, loadMemories, looksSecret, memoryFile, memoryPrompt, removeMemory, MAX_ENTRIES_PER_FILE } from '../src/agent/autoMemory.js';
import { dispatchTool } from '../src/tools/registry.js';
import { evaluatePermission } from '../src/permissions/rules.js';

let workspace: string;
beforeEach(() => {
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-mem-home-'));
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-mem-ws-'));
});

describe('learned memory', () => {
  it('saves notes per project and for every project, as editable Markdown', () => {
    const a = addMemory(workspace, { text: 'Use pnpm, never npm: the lockfile is pnpm-lock.yaml', type: 'feedback' });
    const b = addMemory(workspace, { text: 'Answer in French', type: 'preference', scope: 'user' });
    expect(a.entry?.scope).toBe('project');
    expect(b.entry?.scope).toBe('user');
    expect(fs.readFileSync(memoryFile('project', workspace), 'utf8')).toMatch(/^- \[feedback\] Use pnpm, never npm: the lockfile is pnpm-lock\.yaml <!-- id:[a-f0-9]{6} date:\d{4}-\d{2}-\d{2} -->$/m);
    expect(loadMemories(workspace).map((e) => e.text)).toEqual(['Answer in French', 'Use pnpm, never npm: the lockfile is pnpm-lock.yaml']);
  });

  it('refuses duplicates, secrets and notes past the limit', () => {
    addMemory(workspace, { text: 'Tests run with vitest' });
    expect(addMemory(workspace, { text: 'tests run with Vitest!' }).duplicate).toBeDefined();
    expect(addMemory(workspace, { text: 'API key: AIzaSyA1234567890abcdefghijklmnop' }).error).toMatch(/secret/);
    expect(looksSecret('password = hunter22')).toBe(true);
    expect(looksSecret('The password prompt comes from sudo')).toBe(false);
    for (let i = loadMemories(workspace).length; i < MAX_ENTRIES_PER_FILE; i++) addMemory(workspace, { text: `fact number ${i}` });
    expect(addMemory(workspace, { text: 'one too many' }).error).toMatch(/full/);
  });

  it('removes a note by id and keeps the others', () => {
    const keep = addMemory(workspace, { text: 'Deploys go through GitHub Actions' }).entry!;
    const drop = addMemory(workspace, { text: 'The API lives in services/api' }).entry!;
    expect(removeMemory(workspace, drop.id)?.text).toBe('The API lives in services/api');
    expect(loadMemories(workspace).map((e) => e.id)).toEqual([keep.id]);
    expect(removeMemory(workspace, 'nope')).toBeUndefined();
  });

  it('goes into the system prompt with its ids and rules', () => {
    const e = addMemory(workspace, { text: 'Never edit legacy/', type: 'feedback' }).entry!;
    const prompt = memoryPrompt(loadMemories(workspace));
    expect(prompt).toContain('# Learned memory');
    expect(prompt).toContain(`- [${e.id}] (project · feedback · ${e.date}) Never edit legacy/`);
    expect(memoryPrompt([])).toContain('No notes yet.');
  });

  it('is a tool the agent uses without asking', async () => {
    expect(evaluatePermission('memory', { action: 'add', note: 'x' }, workspace, 'default', {}).decision).toBe('allow');
    const ctx = { cwd: workspace, extraDirs: [], bashTimeoutMs: 1000 };
    const saved = await dispatchTool('memory', { action: 'add', note: 'Run npm test before committing', type: 'project' }, ctx);
    expect(saved.summary).toBe('Saved: Run npm test before committing');
    const listed = await dispatchTool('memory', { action: 'list' }, ctx);
    expect(listed.output).toContain('Run npm test before committing');
    await expect(dispatchTool('memory', { action: 'add', note: 'token=ghp_abcdefghijklmnopqrstuvwxyz123456' }, ctx)).rejects.toThrow(/secret/);
  });
});
