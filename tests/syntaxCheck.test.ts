import { describe, expect, it } from 'vitest';
import { checkSyntax, syntaxWarning } from '../src/tools/syntaxCheck.js';

describe('syntax check after an edit', () => {
  it('accepts valid JSON and JSON with comments, reports a broken one with its line', async () => {
    expect(await checkSyntax('a.json', '{"a": [1, 2]}\n')).toBeNull();
    expect(await checkSyntax('tsconfig.json', '{\n  // comment\n  "compilerOptions": { "strict": true, },\n}\n')).toBeNull();
    const problem = await checkSyntax('package.json', '{\n  "name": "x",\n  "version": 1,,\n}\n');
    expect(problem).not.toBeNull();
    expect(problem!.line).toBe(3);
    expect(problem!.message).toMatch(/Unexpected token|Expected/);
  });

  it('reports the first syntax error of TypeScript, TSX and JavaScript, and none for valid code', async () => {
    expect(await checkSyntax('ok.ts', 'export function f(a: number): number {\n  return a + 1;\n}\n')).toBeNull();
    expect(await checkSyntax('ok.tsx', 'export const A = () => <div className="x">{1}</div>;\n')).toBeNull();
    expect(await checkSyntax('ok.mjs', 'export const a = { b: [1, 2] };\n')).toBeNull();
    const ts = await checkSyntax('bad.ts', 'function f() {\n  return 1;\n\nconst x = ;\n');
    expect(ts).not.toBeNull();
    expect(ts!.line).toBe(4);
    expect(ts!.message).toMatch(/Expression expected/);
    const js = await checkSyntax('bad.js', 'const a = {\n  b: 1\n  c: 2\n};\n');
    expect(js!.line).toBe(3);
    // Type errors are not syntax errors: the project's typecheck is for those.
    expect(await checkSyntax('types.ts', 'const n: number = "text";\n')).toBeNull();
  });

  it('checks Python with ast.parse when python3 is there', async () => {
    expect(await checkSyntax('ok.py', 'def f(x):\n    return x + 1\n')).toBeNull();
    const problem = await checkSyntax('bad.py', 'def f(x)\n    return x\n');
    if (problem) {
      expect(problem.line).toBe(1);
      expect(problem.message).toMatch(/expected ':'|invalid syntax/);
    }
  });

  it('ignores other kinds of files and formats the warning', async () => {
    expect(await checkSyntax('notes.md', '# {{{')).toBeNull();
    expect(await checkSyntax('style.css', 'a {')).toBeNull();
    expect(syntaxWarning(null)).toBe('');
    expect(syntaxWarning({ line: 42, column: 3, message: "Unexpected token '}'" })).toBe("\n\nWarning: the file now has a syntax error at line 42, column 3: Unexpected token '}'. Fix it before moving on.");
  });
});
