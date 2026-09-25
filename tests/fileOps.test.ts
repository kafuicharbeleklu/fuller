import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { previewEdit, editFile, hasPlaceholder } from '../src/tools/fileOps.js';
import { dispatchTool } from '../src/tools/registry.js';

let dir: string;
const ctx = () => ({ cwd: dir });
const write = (name: string, text: string) => fs.writeFileSync(path.join(dir, name), text, 'utf8');
const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8');

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-edit-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('edit_file matching', () => {
  it('replaces the exact text, as before', async () => {
    write('a.ts', 'function f() {\n  return 1;\n}\n');
    const r = await editFile('a.ts', '  return 1;', '  return 2;', ctx());
    expect(read('a.ts')).toBe('function f() {\n  return 2;\n}\n');
    expect(r.message).not.toContain('exact text was not there');
  });

  it('matches one place with indentation and trailing spaces ignored, and re-indents the replacement like the file', async () => {
    write('a.ts', 'class A {\n  run() {\n    if (x) {\n      doIt();   \n    }\n  }\n}\n');
    const r = await editFile('a.ts', 'if (x) {\n  doIt();\n}', 'if (x && y) {\n  doIt();\n  log();\n}', ctx());
    expect(read('a.ts')).toBe('class A {\n  run() {\n    if (x && y) {\n      doIt();\n      log();\n    }\n  }\n}\n');
    expect(r.message).toContain('matched with indentation and trailing spaces ignored');
    expect(r.message).toContain('The edited region now reads:');
  });

  it('refuses when several places match loosely, naming the lines', async () => {
    write('a.ts', 'a();\n  b();\nc();\n    b();\n');
    // Trailing spaces in the target: no exact occurrence, two loose ones.
    await expect(previewEdit('a.ts', 'b();  ', 'd();', ctx())).rejects.toThrow(/2 places match it once indentation and trailing spaces are ignored \(lines 2, 4\)/);
    expect(read('a.ts')).toBe('a();\n  b();\nc();\n    b();\n');
  });

  it('names the lines that look like the first line of a target that is nowhere', async () => {
    write('a.ts', 'const a = 1;\nfunction go() {\n  return a;\n}\nfunction go2() {\n  return 2;\n}\n');
    await expect(previewEdit('a.ts', 'function go() {\n  return b;\n}', 'x', ctx())).rejects.toThrow(/Lines that look like its first line:\n  2: function go\(\) \{\nRead the file around them/);
    await expect(previewEdit('a.ts', 'nothing like this', 'x', ctx())).rejects.toThrow(/was not found in a\.ts\. Read the file again/);
  });

  it('refuses a replacement with a placeholder line instead of writing it', async () => {
    write('a.ts', 'function f() {\n  return 1;\n}\n');
    await expect(previewEdit('a.ts', 'function f() {\n  return 1;\n}', 'function f() {\n  // ... rest of the code\n}', ctx())).rejects.toThrow(/placeholder line/);
    expect(hasPlaceholder('# ... existing code ...')).toBe(true);
    expect(hasPlaceholder('const rest = [...items];')).toBe(false);
    expect(hasPlaceholder('// ...')).toBe(false);
    expect(read('a.ts')).toBe('function f() {\n  return 1;\n}\n');
  });

  it('keeps identical target and replacement as an error, in English', async () => {
    write('a.ts', 'x\n');
    await expect(previewEdit('a.ts', 'x', 'x', ctx())).rejects.toThrow(/identical: nothing to change/);
  });
});

describe('syntax feedback in the tool result', () => {
  const toolCtx = () => ({ cwd: dir, extraDirs: [], bashTimeoutMs: 1000 });

  it('warns after an edit that breaks the file, and says nothing when it parses', async () => {
    write('a.ts', 'function f() {\n  return 1;\n}\n');
    const broken = await dispatchTool('edit_file', { file_path: 'a.ts', target_content: '  return 1;\n}', replacement_content: '  return 1;' }, toolCtx());
    expect(broken.output).toMatch(/Warning: the file now has a syntax error at line \d+/);
    expect(broken.summary).toContain('syntax error');
    expect(read('a.ts')).toBe('function f() {\n  return 1;\n'); // written as asked, not rolled back
    const fixed = await dispatchTool('edit_file', { file_path: 'a.ts', target_content: '  return 1;\n', replacement_content: '  return 1;\n}\n' }, toolCtx());
    expect(fixed.output).not.toContain('Warning');
    expect(fixed.summary).not.toContain('syntax error');
  });

  it('does not blame the edit for an error that was already there (differential check)', async () => {
    write('a.ts', 'function f() {\n  return 1;\n\nconst x = 1;\n'); // missing brace before the edit
    const unrelated = await dispatchTool('edit_file', { file_path: 'a.ts', target_content: 'const x = 1;', replacement_content: 'const x = 2;' }, toolCtx());
    expect(unrelated.output).not.toContain('Warning');
    const worse = await dispatchTool('edit_file', { file_path: 'a.ts', target_content: 'const x = 2;', replacement_content: 'const x = ;' }, toolCtx());
    expect(worse.output).toContain('Warning: the file now has a syntax error');
  });

  it('warns after write_file too, for JSON', async () => {
    const bad = await dispatchTool('write_file', { file_path: 'conf.json', content: '{"a": 1,}\n' }, toolCtx());
    expect(bad.output).toContain('Warning: the file now has a syntax error');
    const good = await dispatchTool('write_file', { file_path: 'conf.json', content: '{"a": 1}\n' }, toolCtx());
    expect(good.output).not.toContain('Warning');
  });
});
