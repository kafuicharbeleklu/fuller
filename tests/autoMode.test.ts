import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { autoModePrompt, parseVerdict, SOFT_DENY_RULES } from '../src/permissions/autoMode.js';
import { evaluatePermission } from '../src/permissions/rules.js';
import { CYCLE_MODES } from '../src/agent/types.js';

describe('auto mode', () => {
  it('cycles like Claude Code: manual → accept edits → plan → auto', () => {
    expect(CYCLE_MODES).toEqual(['default', 'acceptEdits', 'plan', 'auto']);
  });

  it('reads the classifier verdict and treats anything unclear as a denial', () => {
    expect(parseVerdict('```json\n{"decision":"allow","reason":"part of the task"}\n```')).toEqual({ decision: 'allow', reason: 'part of the task' });
    expect(parseVerdict('maybe')).toEqual({ decision: 'deny', reason: 'The classifier gave no clear answer' });
  });

  it('builds a prompt with the rules, the user rules and what the user asked', () => {
    const prompt = autoModePrompt({ action: 'Bash(npm test)', risk: 'exec · runs a command', userRequests: ['fix the tests'], settings: { rules: ['Allow running npm scripts'], disabledBuiltin: ['softDeny'] } });
    expect(prompt).toContain('Action: Bash(npm test)');
    expect(prompt).toContain('- Allow running npm scripts');
    expect(prompt).toContain('> fix the tests');
    expect(prompt).not.toContain(SOFT_DENY_RULES[0]);
  });

  it('keeps a limit written far down a long request, and only the gist of older ones (C007)', () => {
    const consigne = fs.readFileSync(path.resolve('reports/usage/2026-09-25-tache-tmp/consigne-2.txt'), 'utf8');
    expect(consigne.indexOf('do not delete the directories that already exist')).toBeGreaterThan(600);
    const older = 'earlier request '.repeat(80); // 1 280 characters
    const prompt = autoModePrompt({ action: 'Bash(rm -rf /tmp/fuller-evaltasks-x)', risk: 'exec · deletes files', userRequests: [older, consigne] });
    expect(prompt).toContain('do not delete the directories that already exist in /tmp');
    expect(prompt).not.toContain(older); // the older one is cut to its gist (head, marker, tail)
    expect(prompt).toContain(`> ${older.slice(0, 360)} […] `);
    // A huge latest request keeps its head and its tail.
    const huge = `START ${'x'.repeat(10_000)} never touch prod END`;
    const clipped = autoModePrompt({ action: 'Bash(ls)', risk: 'read', userRequests: [huge] });
    expect(clipped).toContain('START');
    expect(clipped).toContain('never touch prod END');
    expect(clipped).toContain('[…]');
  });

  it('lets workspace edits through without the classifier', () => {
    expect(evaluatePermission('write_file', { file_path: 'a.txt', content: 'x' }, '/tmp/p', 'auto', {}).decision).toBe('allow');
    expect(evaluatePermission('execute_bash', { command: 'git push' }, '/tmp/p', 'auto', {}).decision).toBe('ask');
  });
});
