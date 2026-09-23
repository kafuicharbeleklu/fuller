import { describe, expect, it } from 'vitest';
import { evaluatePermission, parseRule, ruleMatches, globToRegExp } from '../src/permissions/rules.js';

const cwd = '/tmp/project';

describe('rule parsing and matching', () => {
  it('parses Tool(spec)', () => {
    expect(parseRule('Bash(npm test:*)')).toEqual({ tool: 'Bash', spec: 'npm test:*', raw: 'Bash(npm test:*)' });
    expect(parseRule('Edit')).toEqual({ tool: 'Edit', spec: undefined, raw: 'Edit' });
    expect(parseRule('bad rule(')).toBeNull();
  });
  it('matches bash prefixes and exact commands', () => {
    const r = parseRule('Bash(npm test:*)')!;
    expect(ruleMatches(r, { tool: 'Bash', target: 'npm test', cwd })).toBe(true);
    expect(ruleMatches(r, { tool: 'Bash', target: 'npm test -- --watch', cwd })).toBe(true);
    expect(ruleMatches(r, { tool: 'Bash', target: 'npm testing', cwd })).toBe(false);
    expect(ruleMatches(parseRule('Bash(ls)')!, { tool: 'Bash', target: 'ls -la', cwd })).toBe(false);
  });
  it('matches file globs', () => {
    expect(globToRegExp('src/**').test('src/a/b.ts')).toBe(true);
    expect(globToRegExp('src/**/*.ts').test('src/a/b.ts')).toBe(true);
    expect(globToRegExp('*.md').test('a/b.md')).toBe(false);
    expect(ruleMatches(parseRule('Edit(src/**)')!, { tool: 'Edit', target: '/tmp/project/src/x.ts', cwd })).toBe(true);
  });
  it('matches web domains', () => {
    expect(ruleMatches(parseRule('WebFetch(domain:docs.python.org)')!, { tool: 'WebFetch', target: 'https://docs.python.org/3/', cwd })).toBe(true);
    expect(ruleMatches(parseRule('WebFetch(domain:python.org)')!, { tool: 'WebFetch', target: 'https://docs.python.org/3/', cwd })).toBe(true);
    expect(ruleMatches(parseRule('WebFetch(domain:python.org)')!, { tool: 'WebFetch', target: 'https://evil.com/python.org', cwd })).toBe(false);
  });
});

describe('evaluatePermission', () => {
  it('reads are always allowed, edits ask by default', () => {
    expect(evaluatePermission('read_file', { file_path: 'a.ts' }, cwd, 'default', {}).decision).toBe('allow');
    expect(evaluatePermission('edit_file', { file_path: 'a.ts' }, cwd, 'default', {}).decision).toBe('ask');
    expect(evaluatePermission('edit_file', { file_path: 'a.ts' }, cwd, 'acceptEdits', {}).decision).toBe('allow');
  });
  it('plan mode denies anything that is not read-only', () => {
    expect(evaluatePermission('execute_bash', { command: 'npm test' }, cwd, 'plan', {}).decision).toBe('deny');
    expect(evaluatePermission('execute_bash', { command: 'git status' }, cwd, 'plan', {}).decision).toBe('allow');
  });
  it('deny rules beat allow rules and bypass mode', () => {
    const settings = { permissions: { allow: ['Bash'], deny: ['Bash(rm:*)'] } };
    expect(evaluatePermission('execute_bash', { command: 'rm x' }, cwd, 'bypassPermissions', settings).decision).toBe('deny');
    expect(evaluatePermission('execute_bash', { command: 'npm test' }, cwd, 'default', settings).decision).toBe('allow');
  });
  it('dangerous commands still ask even with an allow rule', () => {
    const settings = { permissions: { allow: ['Bash'] } };
    const ev = evaluatePermission('execute_bash', { command: 'git reset --hard' }, cwd, 'default', settings);
    expect(ev.decision).toBe('ask');
    expect(ev.danger).toBeTruthy();
  });
  it('acceptEdits auto-accepts fs edits inside the project but not test runs', () => {
    expect(evaluatePermission('execute_bash', { command: 'mkdir src/x' }, cwd, 'acceptEdits', {}).decision).toBe('allow');
    expect(evaluatePermission('execute_bash', { command: 'npm test' }, cwd, 'acceptEdits', {}).decision).toBe('ask');
  });
  it('offers a prefix rule for bash', () => {
    const ev = evaluatePermission('execute_bash', { command: 'npm run build' }, cwd, 'default', {});
    expect(ev.options[1].rule).toBe('Bash(npm run:*)');
  });
});
