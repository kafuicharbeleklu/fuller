import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProjectContext, resolveImports } from '../src/agent/contextLoader.js';

describe('memory files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-mem-'));
  const project = path.join(root, 'proj');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(root, 'FULLER.md'), '# parent\n');
  fs.writeFileSync(path.join(project, 'FULLER.md'), '# project\n@docs/style.md\n```\n@not/imported.md\n```\n');
  fs.mkdirSync(path.join(project, 'docs'));
  fs.writeFileSync(path.join(project, 'docs', 'style.md'), 'STYLE RULES');

  it('loads parent and project files with imports', () => {
    const files = loadProjectContext(project);
    const paths = files.map((f) => f.path);
    expect(paths).toContain(path.join(root, 'FULLER.md'));
    expect(paths).toContain(path.join(project, 'FULLER.md'));
    const proj = files.find((f) => f.path === path.join(project, 'FULLER.md'))!;
    expect(proj.content).toContain('STYLE RULES');
    expect(proj.content).toContain('@not/imported.md');
  });
  it('limits import depth', () => {
    const content = resolveImports('@docs/style.md', project, 4);
    expect(content).toBe('@docs/style.md');
  });
});
