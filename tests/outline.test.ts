import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { outlineFile } from '../src/tools/outline.js';

describe('outline_file', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-outline-'));
  const tsCode = `
export interface User {
  id: string;
  name: string;
}

export type UserRole = 'admin' | 'guest';

export class UserManager {
  constructor() {}
}

export async function getUser(id: string): Promise<User> {
  return { id, name: 'Alice' };
}

const formatUser = (user: User) => user.name;
`;
  fs.writeFileSync(path.join(cwd, 'user.ts'), tsCode);

  const pyCode = `
class Agent:
    def __init__(self, name):
        self.name = name

async def run_task(task: str) -> bool:
    return True
`;
  fs.writeFileSync(path.join(cwd, 'agent.py'), pyCode);

  const emptyCode = `// Just comments\n// and blank lines\n`;
  fs.writeFileSync(path.join(cwd, 'empty.ts'), emptyCode);

  it('extracts TypeScript interfaces, types, classes and functions with line numbers', async () => {
    const res = await outlineFile('user.ts', cwd);
    expect(res.count).toBe(5);
    expect(res.outline).toContain('[interface] export interface User');
    expect(res.outline).toContain('[type] export type UserRole');
    expect(res.outline).toContain('[class] export class UserManager');
    expect(res.outline).toContain('[function] export async function getUser(id: string): Promise<User>');
    expect(res.outline).toContain('[const-fn] const formatUser');
  });

  it('extracts Python classes and functions with line numbers', async () => {
    const res = await outlineFile('agent.py', cwd);
    expect(res.count).toBe(3);
    expect(res.outline).toContain('[class] class Agent');
    expect(res.outline).toContain('[def] def __init__(self, name)');
    expect(res.outline).toContain('[def] async def run_task(task: str) -> bool');
  });

  it('handles files with no symbols gracefully', async () => {
    const res = await outlineFile('empty.ts', cwd);
    expect(res.count).toBe(0);
    expect(res.outline).toContain('No symbols');
  });

  it('throws error for non-existent or directory paths', async () => {
    await expect(outlineFile('nonexistent.ts', cwd)).rejects.toThrow();
  });
});
