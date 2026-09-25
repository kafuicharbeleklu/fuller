import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
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
    expect(ev.options.map((option) => option.value)).toEqual(['yes', 'no']);
    expect(evaluatePermission('execute_bash', { command: 'sudo rm -rf /var/lib/app' }, cwd, 'default', {}).options.map((option) => option.value)).toEqual(['yes', 'no']);
  });
  it('asks before a file tool leaves the workspace, whatever the mode', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-rules-outside-'));
    const read = { file_path: path.join(outside, 'notes.txt') };
    for (const mode of ['default', 'acceptEdits', 'plan'] as const) {
      const ev = evaluatePermission('read_file', read, cwd, mode, {});
      expect(ev.decision).toBe('ask');
      expect(ev.outsideDir).toBe(outside);
    }
    expect(evaluatePermission('write_file', read, cwd, 'plan', {}).decision).toBe('deny');
    expect(evaluatePermission('write_file', read, cwd, 'acceptEdits', {}).decision).toBe('ask');
    expect(evaluatePermission('read_file', read, cwd, 'bypassPermissions', {})).toMatchObject({ decision: 'allow', outsideDir: outside });
    // An added directory is part of the workspace; a deny rule still wins.
    expect(evaluatePermission('read_file', read, cwd, 'default', {}, [outside])).toMatchObject({ decision: 'allow', outsideDir: undefined });
    expect(evaluatePermission('read_file', read, cwd, 'default', { permissions: { deny: [`Read(/${outside}/**)`] } }).decision).toBe('deny');
    const home = process.env.HOME;
    try {
      process.env.HOME = path.dirname(outside);
      expect(evaluatePermission('read_file', read, cwd, 'default', { permissions: { deny: [`Read(~/${path.basename(outside)}/*.txt)`] } }).decision).toBe('deny');
    } finally { process.env.HOME = home; }
  });
  it('sees a symlink leaving the workspace as outside', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-rules-link-'));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-rules-project-'));
    fs.symlinkSync(outside, path.join(project, 'link'));
    expect(evaluatePermission('list_directory', { dir_path: 'link' }, project, 'default', {})).toMatchObject({ decision: 'ask', outsideDir: outside });
  });
  it('asks for sudo like Claude Code: an approval note and the exact command to remember', () => {
    const command = 'sudo ip link set tun0 down && sudo ip link set tun1 down';
    const ev = evaluatePermission('execute_bash', { command }, cwd, 'default', {});
    expect(ev.decision).toBe('ask');
    expect(ev.danger).toBeUndefined();
    expect(ev.note).toBe('This command requires approval');
    expect(ev.options).toEqual([
      { value: 'yes', label: 'Yes' },
      { value: 'always', label: `Yes, and don’t ask again for: ${command}`, rule: `Bash(${command})` },
      { value: 'no', label: 'No' },
    ]);
    // The remembered rule covers that command word for word, not other sudo commands.
    const settings = { permissions: { allow: [`Bash(${command})`, 'Bash(sudo:*)'] } };
    expect(evaluatePermission('execute_bash', { command }, cwd, 'default', settings).decision).toBe('allow');
    expect(evaluatePermission('execute_bash', { command: 'sudo ip link set tun2 down' }, cwd, 'default', settings).decision).toBe('ask');
  });
  it('keeps the danger warning when what sudo runs is itself destructive', () => {
    for (const command of ['sudo rm -rf /var/lib/app', 'sudo -u root dd if=/dev/zero of=/dev/sda', 'sudo true && shutdown now']) {
      const ev = evaluatePermission('execute_bash', { command }, cwd, 'default', { permissions: { allow: [`Bash(${command})`] } });
      expect(ev.decision).toBe('ask');
      expect(ev.danger).toBeTruthy();
      expect(ev.note).toBeUndefined();
    }
  });
  it('acceptEdits auto-accepts fs edits inside the project but not test runs', () => {
    expect(evaluatePermission('execute_bash', { command: 'mkdir src/x' }, cwd, 'acceptEdits', {}).decision).toBe('allow');
    expect(evaluatePermission('execute_bash', { command: 'npm test' }, cwd, 'acceptEdits', {}).decision).toBe('ask');
  });
  it('offers a prefix rule for bash', () => {
    const ev = evaluatePermission('execute_bash', { command: 'npm run build' }, cwd, 'default', {});
    expect(ev.options[1].rule).toBe('Bash(npm run:*)');
  });
  it('offers one rule per subcommand needing approval for a compound command, like Claude Code', () => {
    const ev = evaluatePermission('execute_bash', { command: 'cd src && npm test && wget https://example.com/file' }, cwd, 'default', {});
    expect(ev.options.map((option) => option.value)).toEqual(['yes', 'always', 'no']);
    expect(ev.options[1].rules).toEqual(['Bash(npm test:*)', 'Bash(wget:*)']);
    expect(ev.options[1].label).toBe(`Yes, and don't ask again for \`npm test\` and \`wget\` commands in \`${cwd}\``);
    const allowed = { permissions: { allow: ['Bash(npm test:*)'] } };
    expect(evaluatePermission('execute_bash', { command: 'npm test && wget https://example.com/file' }, cwd, 'default', allowed).options[1].rules).toBeUndefined();
    expect(evaluatePermission('execute_bash', { command: 'npm test && wget https://example.com/file' }, cwd, 'default', allowed).options[1].rule).toBe('Bash(wget:*)');
  });
  it('offers only a one-time approval beyond 5 rules', () => {
    const command = ['npm test', 'make', 'cargo build', 'go test', 'wget x', 'curl -o y x'].join(' && ');
    expect(evaluatePermission('execute_bash', { command }, cwd, 'default', {}).options.map((option) => option.value)).toEqual(['yes', 'no']);
  });
  it('matches allow rules against every subcommand and deny rules against any', () => {
    const settings = { permissions: { allow: ['Bash(npm test:*)'] } };
    expect(evaluatePermission('execute_bash', { command: 'npm test && git push' }, cwd, 'default', settings).decision).toBe('ask');
    expect(evaluatePermission('execute_bash', { command: 'cd src && npm test' }, cwd, 'default', settings).decision).toBe('allow');
    const both = { permissions: { allow: ['Bash(npm test:*)', 'Bash(git push:*)'] } };
    expect(evaluatePermission('execute_bash', { command: 'npm test && git push' }, cwd, 'default', both).decision).toBe('allow');
    const deny = { permissions: { deny: ['Bash(git push:*)'] } };
    expect(evaluatePermission('execute_bash', { command: 'npm test && git push' }, cwd, 'bypassPermissions', deny).decision).toBe('deny');
  });
});

describe('ask rules', () => {
  it('prompt even when an allow rule or the mode would allow', async () => {
    const { evaluatePermission } = await import('../src/permissions/rules.js');
    const settings = { permissions: { allow: ['Bash(git:*)'], ask: ['Bash(git push:*)'] } };
    expect(evaluatePermission('execute_bash', { command: 'git status' }, '/tmp/p', 'default', settings as any).decision).toBe('allow');
    expect(evaluatePermission('execute_bash', { command: 'git push origin main' }, '/tmp/p', 'bypassPermissions', settings as any).decision).toBe('ask');
    expect(evaluatePermission('read_file', { path: 'a.txt' }, '/tmp/p', 'default', { permissions: { ask: ['Read'] } } as any).decision).toBe('ask');
  });
});
