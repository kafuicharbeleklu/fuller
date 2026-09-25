import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSubagents, normalizeToolName } from '../src/agent/subagents.js';

describe('subagent definitions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-agents-'));
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  const project = path.join(root, 'p');
  const home = path.join(root, 'h');
  fs.mkdirSync(path.join(project, '.fuller', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(project, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(project, '.fuller', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Reviews code\ntools: Read, Grep, Bash\nmaxTurns: 10\n---\nReview carefully.');
  fs.writeFileSync(path.join(project, '.claude', 'agents', 'legacy.md'), '---\ndescription: From Claude Code\ntools: [Read, Glob]\n---\nLegacy body');

  it('loads project and Claude Code agents plus built-ins, mapping tool names', () => {
    const defs = loadSubagents(project, home);
    const names = defs.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(['reviewer', 'legacy', 'general-purpose', 'Explore']));
    const reviewer = defs.find((d) => d.name === 'reviewer')!;
    expect(reviewer.tools).toEqual(['read_file', 'search_files', 'execute_bash']);
    expect(reviewer.maxTurns).toBe(10);
    expect(reviewer.prompt).toBe('Review carefully.');
    const legacy = defs.find((d) => d.name === 'legacy')!;
    expect(legacy.tools).toEqual(['read_file', 'glob']);
    expect(legacy.scope).toBe('claude-project');
  });
  it('normalizes tool names', () => {
    expect(normalizeToolName('Bash')).toBe('execute_bash');
    expect(normalizeToolName('search_files')).toBe('search_files');
  });
});
