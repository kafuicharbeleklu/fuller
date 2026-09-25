import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFrontmatter, loadSkills, expandSkill, skillsForPrompt } from '../src/skills/loader.js';

describe('frontmatter', () => {
  it('parses scalars, inline lists, block lists and booleans', () => {
    const { meta, body } = parseFrontmatter('---\ndescription: "Do X"\nallowed-tools: [Bash(git diff:*), "Edit(src/**)"]\nmodel: gemini-3.8-flash\ndisable-model-invocation: true\ntags:\n  - a\n  - b\n---\nBody line\n');
    expect(meta.description).toBe('Do X');
    expect(meta['allowed-tools']).toEqual(['Bash(git diff:*)', 'Edit(src/**)']);
    expect(meta['disable-model-invocation']).toBe(true);
    expect(meta.tags).toEqual(['a', 'b']);
    expect(body).toBe('Body line\n');
  });
  it('returns the whole text when there is no frontmatter', () => {
    expect(parseFrontmatter('# Title\ntext').body).toBe('# Title\ntext');
  });
});

describe('loadSkills', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-skills-'));
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  const project = path.join(root, 'proj');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(project, '.fuller', 'commands', 'git'), { recursive: true });
  fs.mkdirSync(path.join(project, '.fuller', 'skills', 'deploy'), { recursive: true });
  fs.mkdirSync(path.join(home, '.fuller', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(project, '.claude', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(project, '.fuller', 'commands', 'review.md'), '---\ndescription: Review\nargument-hint: [focus]\n---\nReview $ARGUMENTS');
  fs.writeFileSync(path.join(project, '.fuller', 'commands', 'git', 'commit.md'), 'Commit the changes');
  fs.writeFileSync(path.join(project, '.fuller', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Deploy\nuser-invocable: false\n---\nSteps');
  fs.writeFileSync(path.join(home, '.fuller', 'commands', 'review.md'), 'User-level review (shadowed)');
  fs.writeFileSync(path.join(home, '.fuller', 'commands', 'standup.md'), 'Standup notes');
  fs.writeFileSync(path.join(project, '.claude', 'commands', 'legacy.md'), '---\ndescription: From Claude Code\n---\nLegacy');

  const skills = loadSkills(project, home);
  it('discovers commands, nested commands, skills and Claude Code fallbacks with precedence', () => {
    const names = skills.map((s) => `${s.name}@${s.scope}`);
    expect(names).toContain('review@project');
    expect(names).toContain('git:commit@project');
    expect(names).toContain('deploy@project');
    expect(names).toContain('standup@user');
    expect(names).toContain('legacy@claude-project');
    expect(names).not.toContain('review@user');
  });
  it('reads metadata and defaults', () => {
    const review = skills.find((s) => s.name === 'review')!;
    expect(review.description).toBe('Review');
    expect(review.argumentHint).toBe('[focus]');
    expect(review.userInvocable).toBe(true);
    const deploy = skills.find((s) => s.name === 'deploy')!;
    expect(deploy.userInvocable).toBe(false);
    expect(deploy.kind).toBe('skill');
    const commit = skills.find((s) => s.name === 'git:commit')!;
    expect(commit.description).toBe('Commit the changes');
  });
  it('lists model-invocable skills for the prompt', () => {
    expect(skillsForPrompt(skills)).toContain('- deploy: Deploy');
  });
  it('expands arguments and inline shell commands', async () => {
    const skill = { ...skills.find((s) => s.name === 'review')!, body: 'Focus: $ARGUMENTS\nFirst: $1 Second: $2\nOut: !`echo hello`' };
    const out = await expandSkill(skill, 'auth "token refresh"', project);
    expect(out).toContain('Focus: auth "token refresh"');
    expect(out).toContain('First: auth Second: token refresh');
    expect(out).toContain('$ echo hello\nhello');
  });
});
