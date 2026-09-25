import path from 'node:path';
import { execFile } from 'node:child_process';
import { loadTypeScript } from './outline.js';

/**
 * A syntax check right after write_file or edit_file, reported in the tool result: the model
 * fixes a missing brace on the next call instead of discovering it at the next build, or never.
 * Parsing only, never the project's code: JSON with JSON.parse (JSONC accepted), JavaScript and
 * TypeScript with Fuller's own TypeScript parser, Python with `ast.parse` in a python3 process.
 * Type errors are not looked at: that is the project's typecheck, run by the model.
 */
export interface SyntaxProblem {
  line?: number;
  column?: number;
  message: string;
}

/** Bigger files are not checked: the parse would slow every edit down. */
const MAX_CHARS = 1_500_000;
const PYTHON_TIMEOUT_MS = 5_000;

export async function checkSyntax(file: string, content: string): Promise<SyntaxProblem | null> {
  if (content.length > MAX_CHARS) return null;
  const ext = path.extname(file).toLowerCase();
  try {
    switch (ext) {
      case '.json': case '.jsonc': return checkJson(file, content);
      case '.ts': case '.tsx': case '.mts': case '.cts':
      case '.js': case '.jsx': case '.mjs': case '.cjs':
        return checkTypeScript(file, content);
      case '.py': case '.pyi': return await checkPython(file, content);
      default: return null;
    }
  } catch {
    return null;
  }
}

/** "Warning: syntax error at line 42: …" for a tool result, or '' when the file parses. */
export function syntaxWarning(problem: SyntaxProblem | null): string {
  if (!problem) return '';
  const where = problem.line ? ` at line ${problem.line}${problem.column ? `, column ${problem.column}` : ''}` : '';
  return `\n\nWarning: the file now has a syntax error${where}: ${problem.message}. Fix it before moving on.`;
}

function positionToLine(content: string, position: number): { line: number; column: number } {
  const before = content.slice(0, Math.max(0, position));
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/** Files read as JSON with comments (and trailing commas): tsconfig, jsconfig, .vscode/*, *.jsonc, devcontainer.json. */
const JSONC_FILE = /(?:^|[\\/])(?:tsconfig[^\\/]*\.json|jsconfig[^\\/]*\.json|devcontainer\.json|[^\\/]+\.jsonc|\.vscode[\\/][^\\/]+\.json)$/i;

function checkJson(file: string, content: string): SyntaxProblem | null {
  try {
    JSON.parse(content);
    return null;
  } catch (err: any) {
    // tsconfig.json, .vscode/settings.json…: comments and trailing commas are fine there, not in package.json.
    const ts = JSONC_FILE.test(file) ? loadTypeScript() : null;
    if (ts && !ts.parseConfigFileTextToJson(file, content).error) return null;
    const message = String(err?.message ?? err);
    const atPosition = message.match(/position (\d+)/);
    const lineColumn = message.match(/line (\d+) column (\d+)/);
    if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]), message: message.replace(/\s*\(line \d+ column \d+\)/, '') };
    if (atPosition) return { ...positionToLine(content, Number(atPosition[1])), message: message.replace(/ in JSON at position \d+.*$/s, '') };
    return { message };
  }
}

function checkTypeScript(file: string, content: string): SyntaxProblem | null {
  const ts = loadTypeScript();
  if (!ts) return null;
  const result = ts.transpileModule(content, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, allowJs: true },
  });
  const diagnostic = (result.diagnostics ?? []).find((d) => d.category === ts.DiagnosticCategory.Error);
  if (!diagnostic) return null;
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  if (diagnostic.file && diagnostic.start !== undefined) {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return { line: line + 1, column: character + 1, message };
  }
  return { message };
}

const PYTHON_CHECK = [
  'import ast, sys',
  'try:',
  '    ast.parse(sys.stdin.read(), sys.argv[1])',
  'except SyntaxError as e:',
  '    print(f"{e.lineno or 0}:{e.offset or 0}:{e.msg}")',
].join('\n');

function checkPython(file: string, content: string): Promise<SyntaxProblem | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof execFile>;
    try {
      child = execFile('python3', ['-c', PYTHON_CHECK, path.basename(file)], { timeout: PYTHON_TIMEOUT_MS, maxBuffer: 64 * 1024 }, (error, stdout) => {
        // No python3, a timeout, or a crash: no verdict rather than a wrong one.
        if (error && !stdout) return resolve(null);
        const out = String(stdout).trim();
        if (!out) return resolve(null);
        const m = out.match(/^(\d+):(\d+):(.*)$/s);
        if (!m) return resolve({ message: out });
        resolve({ line: Number(m[1]) || undefined, column: Number(m[2]) || undefined, message: m[3].trim() });
      });
    } catch {
      return resolve(null);
    }
    child.stdin?.on('error', () => {});
    child.stdin?.end(content);
  });
}
