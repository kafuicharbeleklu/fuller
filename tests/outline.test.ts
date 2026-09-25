import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { outlineFile, outlineSource } from '../src/tools/outline.js';
import { evaluatePermission } from '../src/permissions/rules.js';
import { loadSubagents } from '../src/agent/subagents.js';
import { REVIEWER } from '../src/agent/review.js';

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
    // The constructor is a class member: 6 symbols with the TypeScript parser.
    expect(res.count).toBe(6);
    expect(res.outline).toContain('[interface] export interface User');
    expect(res.outline).toContain('[type] export type UserRole');
    expect(res.outline).toContain('[class] export class UserManager');
    expect(res.outline).toContain('[function] export async function getUser(id: string): Promise<User>');
    expect(res.outline).toContain('[function] const formatUser');
    expect(res.outline).toContain('[constructor] constructor()');
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

  // A class with methods, a declaration over several lines, and regex literals holding braces,
  // quotes and backticks: what a regex outline used to miss.
  const classCode = [
    'const PATTERN = /[{`"]+$/;',                        // 1
    'export class Tracker {',                            // 2
    '  private count = 0;',                                // 3
    '  constructor(private readonly name: string) {}',     // 4
    '  noteCommand(command: string, output: string): void {', // 5
    "    if (/\\{$/.test(command)) this.count++;",         // 6
    '  }',                                                 // 7
    '  get size(): number { return this.count; }',         // 8
    '  private async beforeConclude(',                     // 9
    '    todos: string[] | null,',                         // 10
    '  ): Promise<string | null> {',                       // 11
    '    return null;',                                    // 12
    '  }',                                                 // 13
    '}',                                                   // 14
    'export async function outlineFile(',                  // 15
    '  filePath: string,',                                 // 16
    '): Promise<void> {}',                                 // 17
    'export const LIMIT = 4;',                             // 18
  ].join('\n');

  it('lists class members and declarations over several lines, with line ranges (TypeScript parser)', () => {
    const { symbols, parser } = outlineSource('tracker.ts', classCode);
    expect(parser).toBe('typescript');
    const found = symbols.map((s) => `${s.line}${s.endLine && s.endLine !== s.line ? `-${s.endLine}` : ''} ${s.kind} ${s.depth}`);
    expect(found).toEqual(['2-14 class 0', '4 constructor 1', '5-7 method 1', '8 getter 1', '9-13 method 1', '15-17 function 0', '18 const 0']);
    expect(symbols.find((s) => s.line === 9)?.signature).toBe('private async beforeConclude( todos: string[] | null, ): Promise<string | null>');
  });

  it('finds the same declarations with patterns when TypeScript is not installed', () => {
    const { symbols, parser } = outlineSource('tracker.ts', classCode, { typescript: null });
    expect(parser).toBe('patterns');
    expect(symbols.map((s) => `${s.line} ${s.kind}`)).toEqual(['2 class', '4 constructor', '5 method', '8 getter', '9 method', '15 function', '18 const']);
  });

  it('finds Python methods, a multi-line def and Rust impl blocks', () => {
    const py = outlineSource('a.py', 'class A:\n    def run(\n        self,\n    ):\n        pass\n', { typescript: null });
    expect(py.symbols.map((s) => `${s.line} ${s.kind}`)).toEqual(['1 class', '2 def']);
    const rs = outlineSource('a.rs', 'pub struct S;\nimpl S {\n    pub fn new(\n    ) -> Self { S }\n}\n', { typescript: null });
    expect(rs.symbols.map((s) => `${s.line} ${s.kind}`)).toEqual(['1 struct/enum/trait', '2 impl', '3 fn']);
  });

  it('is a read for permissions: allowed like read_file, plan mode included, and bound by Read rules', () => {
    for (const mode of ['default', 'acceptEdits', 'plan'] as const) {
      expect(evaluatePermission('outline_file', { file_path: 'user.ts' }, cwd, mode, {}).decision).toBe('allow');
    }
    const denied = evaluatePermission('outline_file', { file_path: 'secret/keys.ts' }, cwd, 'default', { permissions: { deny: ['Read(secret/**)'] } });
    expect(denied.decision).toBe('deny');
  });

  it('is available to the read-only subagents', () => {
    expect(loadSubagents(cwd, cwd).find((d) => d.name === 'Explore')?.tools).toContain('outline_file');
    expect(REVIEWER.tools).toContain('outline_file');
  });

  it('never loads the project\'s own typescript package (it could run the project\'s code)', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-outline-hostile-'));
    fs.mkdirSync(path.join(project, 'node_modules', 'typescript'), { recursive: true });
    fs.writeFileSync(path.join(project, 'package.json'), '{"name":"hostile"}');
    fs.writeFileSync(path.join(project, 'node_modules', 'typescript', 'package.json'), '{"name":"typescript","main":"index.js"}');
    fs.writeFileSync(path.join(project, 'node_modules', 'typescript', 'index.js'), "require('fs').writeFileSync(__dirname + '/../../RAN', 'x');");
    fs.writeFileSync(path.join(project, 'a.ts'), 'export class A {\n  run(): void {}\n}\n');
    const res = await outlineFile('a.ts', project);
    expect(fs.existsSync(path.join(project, 'RAN'))).toBe(false);
    expect(res.outline).toContain('line ranges from the TypeScript parser');
    expect(res.outline).toContain('[method] run(): void');
  });
});

