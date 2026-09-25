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

  it('keeps complete earlier instructions as well as the latest request', () => {
    const consigne = fs.readFileSync(path.resolve('reports/usage/2026-09-25-tache-tmp/consigne-2.txt'), 'utf8');
    expect(consigne.indexOf('do not delete the directories that already exist')).toBeGreaterThan(600);
    const older = 'earlier request '.repeat(80); // 1 280 characters
    const prompt = autoModePrompt({ action: 'Bash(rm -rf /tmp/fuller-evaltasks-x)', risk: 'exec · deletes files', userRequests: [older, consigne] });
    expect(prompt).toContain('do not delete the directories that already exist in /tmp');
    expect(prompt).toContain(older);
    expect(prompt).toContain(consigne);
  });

  it.each([1, 3, 6])('keeps the original restriction after %i continuation messages', (count) => {
    const consigne = fs.readFileSync(path.resolve('reports/usage/2026-09-25-tache-tmp/consigne-2.txt'), 'utf8');
    const prompt = autoModePrompt({ action: 'Bash(command under review)', risk: 'exec', userRequests: [consigne, ...Array(count).fill('continue')] });
    expect(prompt).toContain(consigne);
    expect(prompt).toContain('do not delete the directories that already exist in /tmp');
  });

  it('preserves restrictions in the middle of a long request, not just its head and tail', () => {
    const task = `${'x'.repeat(5_000)}\nNever modify production.conf.\n${'y'.repeat(5_000)}`;
    const prompt = autoModePrompt({ action: 'Bash(command under review)', risk: 'exec', userRequests: [task, 'continue'] });
    expect(prompt).toContain(task);
    expect(prompt).not.toContain('[…]');
  });

  it('keeps explicit user amendments in order instead of guessing which task limits expired', () => {
    const requests = ['Do not edit tests.', 'Only tests/unit.ts may now be edited.', 'continue'];
    const prompt = autoModePrompt({ action: 'Bash(command under review)', risk: 'exec', userRequests: requests });
    const offsets = requests.map((text) => prompt.indexOf(`> ${text}`));
    expect(offsets.every((offset) => offset >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it('requires explicit approval when the full instructions cannot fit, without silently clipping them', () => {
    const request = { action: 'Bash(command under review)', risk: 'exec' };
    expect(() => autoModePrompt({ ...request, userRequests: ['x'.repeat(30_000)] })).toThrow('Complete user instructions exceed');
    expect(() => autoModePrompt({ ...request, userRequests: ['x'.repeat(13_000), 'y'.repeat(13_000), 'continue'] })).toThrow('Complete user instructions exceed');
  });

  it('keeps instructions at the size limit and asks for approval if a continuation exceeds it', () => {
    const task = 'x'.repeat(24_000);
    const request = { action: 'Bash(command under review)', risk: 'exec' };
    expect(autoModePrompt({ ...request, userRequests: [task] })).toContain(task);
    expect(() => autoModePrompt({ ...request, userRequests: [task, 'continue'] })).toThrow('Complete user instructions exceed');
  });

  it('lets workspace edits through without the classifier', () => {
    expect(evaluatePermission('write_file', { file_path: 'a.txt', content: 'x' }, '/tmp/p', 'auto', {}).decision).toBe('allow');
    expect(evaluatePermission('execute_bash', { command: 'git push' }, '/tmp/p', 'auto', {}).decision).toBe('ask');
  });
});
