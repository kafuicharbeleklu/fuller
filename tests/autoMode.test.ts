import { describe, expect, it } from 'vitest';
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

  it('lets workspace edits through without the classifier', () => {
    expect(evaluatePermission('write_file', { file_path: 'a.txt', content: 'x' }, '/tmp/p', 'auto', {}).decision).toBe('allow');
    expect(evaluatePermission('execute_bash', { command: 'git push' }, '/tmp/p', 'auto', {}).decision).toBe('ask');
  });
});
