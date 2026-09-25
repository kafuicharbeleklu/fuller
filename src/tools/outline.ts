import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertReadable } from './paths.js';
import { isProbablyBinary, LIMITS, truncateHead } from './truncate.js';

export interface OutlineSymbol {
  line: number;
  /** Last line of the symbol, when the parser knows it (read_file offset/limit). */
  endLine?: number;
  kind: string;
  signature: string;
  /** 0 at the top level, 1 for a class member… */
  depth: number;
}

type TS = typeof import('typescript');

const JS_LIKE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
let loaded: TS | null | undefined;

/**
 * TypeScript's parser, from Fuller's own dependencies only: loading the project's copy would run
 * the project's code from a read-only tool (a hostile repository could ship its own
 * node_modules/typescript). Without it, the pattern outline below is used.
 */
function loadTypeScript(): TS | null {
  if (loaded !== undefined) return loaded;
  try { loaded = createRequire(import.meta.url)('typescript') as TS; } catch { loaded = null; }
  return loaded;
}

/** One line, whitespace collapsed, without the trailing brace or colon. */
function tidy(text: string): string {
  const one = text.replace(/\s+/g, ' ').replace(/[\s{:;=]+$/, '').trim();
  return one.length > 160 ? `${one.slice(0, 159)}…` : one;
}

/** Exact outline of JavaScript and TypeScript: declarations over several lines, class members, line ranges. */
function outlineWithTypeScript(ts: TS, file: string, content: string): OutlineSymbol[] {
  const scriptKind = /\.tsx$/i.test(file) ? ts.ScriptKind.TSX : /\.jsx$/i.test(file) ? ts.ScriptKind.JSX
    : /\.(js|mjs|cjs)$/i.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
  const symbols: OutlineSymbol[] = [];
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  // Declarations start after their comments and decorators; the heading stops at the body.
  const add = (node: import('typescript').Node, kind: string, depth: number, headingEnd?: number) => {
    const start = node.getStart(sf);
    const end = headingEnd ?? Math.min(node.getEnd(), content.indexOf('\n', start) === -1 ? node.getEnd() : content.indexOf('\n', start));
    symbols.push({ line: lineOf(start), endLine: lineOf(node.getEnd()), kind, signature: tidy(content.slice(start, end)), depth });
  };
  const braceAfter = (node: import('typescript').Node, from: number) => {
    const i = content.indexOf('{', from);
    return i === -1 || i > node.getEnd() ? undefined : i;
  };
  const member = (m: import('typescript').ClassElement, depth: number) => {
    if (ts.isConstructorDeclaration(m)) add(m, 'constructor', depth, m.body?.getStart(sf));
    else if (ts.isMethodDeclaration(m)) add(m, 'method', depth, m.body?.getStart(sf));
    else if (ts.isGetAccessorDeclaration(m)) add(m, 'getter', depth, m.body?.getStart(sf));
    else if (ts.isSetAccessorDeclaration(m)) add(m, 'setter', depth, m.body?.getStart(sf));
    else if (ts.isPropertyDeclaration(m) && m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))) {
      add(m, 'method', depth, m.initializer.body.getStart(sf));
    }
  };
  const visit = (node: import('typescript').Node, depth: number) => {
    if (ts.isFunctionDeclaration(node) && node.name) add(node, 'function', depth, node.body?.getStart(sf));
    else if (ts.isClassDeclaration(node)) {
      add(node, 'class', depth, braceAfter(node, (node.name ?? node).getEnd()));
      for (const m of node.members) member(m, depth + 1);
    } else if (ts.isInterfaceDeclaration(node)) add(node, 'interface', depth, braceAfter(node, node.name.getEnd()));
    else if (ts.isTypeAliasDeclaration(node)) add(node, 'type', depth);
    else if (ts.isEnumDeclaration(node)) add(node, 'enum', depth, braceAfter(node, node.name.getEnd()));
    else if (ts.isModuleDeclaration(node)) {
      add(node, 'namespace', depth, braceAfter(node, node.name.getEnd()));
      if (node.body && ts.isModuleBlock(node.body)) for (const s of node.body.statements) visit(s, depth + 1);
    } else if (ts.isVariableStatement(node)) {
      const exported = !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const d of node.declarationList.declarations) {
        const init = d.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) add(node, 'function', depth, init.body.getStart(sf));
        else if (init && ts.isClassExpression(init)) {
          add(node, 'class', depth, braceAfter(init, init.getStart(sf)));
          for (const m of init.members) member(m, depth + 1);
        } else if (exported) add(node, 'const', depth);
      }
    }
  };
  for (const statement of sf.statements) visit(statement, 0);
  return symbols;
}

/** Brace depth at the start of each line, and whether the line starts in code (not in a comment or template text). */
function braceDepths(lines: string[]): { depth: number[]; code: boolean[] } {
  const depth: number[] = [];
  const code: boolean[] = [];
  let d = 0;
  let block = false;
  // Template literals nest: `…${ expression { … } }…`.
  const stack: Array<{ kind: 'tpl' } | { kind: 'expr'; braces: number }> = [];
  for (const line of lines) {
    depth.push(d);
    code.push(!block && stack[stack.length - 1]?.kind !== 'tpl');
    let quote: string | null = null;
    // Last significant character in code: a slash after one of these starts a regex literal.
    let prev = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      const next = line[i + 1];
      if (c !== ' ' && c !== '\t' && !block && !quote && stack[stack.length - 1]?.kind !== 'tpl') {
        if (c === '/' && next !== '/' && next !== '*' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || /\b(?:return|typeof|case)$/.test(line.slice(0, i).trimEnd()))) {
          // Skip /regex/flags, including braces, quotes and slashes inside [classes].
          let inClass = false;
          for (i++; i < line.length; i++) {
            if (line[i] === '\\') i++;
            else if (line[i] === '[') inClass = true;
            else if (line[i] === ']') inClass = false;
            else if (line[i] === '/' && !inClass) break;
          }
          prev = 'x';
          continue;
        }
      }
      if (block) {
        if (c === '*' && next === '/') { block = false; i++; }
        continue;
      }
      const top = stack[stack.length - 1];
      if (top?.kind === 'tpl') {
        if (c === '\\') i++;
        else if (c === '`') { stack.pop(); prev = 'x'; }
        else if (c === '$' && next === '{') { stack.push({ kind: 'expr', braces: 0 }); i++; }
        continue;
      }
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) { quote = null; prev = 'x'; }
        continue;
      }
      if (c === '/' && next === '/') break;
      if (c === '/' && next === '*') { block = true; i++; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '`') stack.push({ kind: 'tpl' });
      else if (c === '{') { if (top?.kind === 'expr') top.braces++; else d++; }
      else if (c === '}') {
        if (top?.kind === 'expr') { if (top.braces === 0) stack.pop(); else top.braces--; }
        else d = Math.max(0, d - 1);
      }
      if (c !== ' ' && c !== '\t') prev = c;
    }
  }
  return { depth, code };
}

const JS_PATTERNS: Array<{ kind: string; regex: RegExp }> = [
  { kind: 'function', regex: /^\s*(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?function\b/ },
  { kind: 'function', regex: /^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>|\([^)]*$)/ },
  { kind: 'const', regex: /^\s*export\s+(?:declare\s+)?(?:const|let|var)\s+[A-Za-z_$]/ },
  { kind: 'class', regex: /^\s*(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:abstract\s+)?class\b/ },
  { kind: 'interface', regex: /^\s*(?:export\s+)?(?:declare\s+)?interface\s+\w/ },
  { kind: 'type', regex: /^\s*(?:export\s+)?(?:declare\s+)?type\s+[A-Za-z_$][\w$]*(?:<[^>]*>)?\s*=/ },
  { kind: 'enum', regex: /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+\w/ },
];
const MODIFIERS = '(?:(?:public|private|protected|static|readonly|override|abstract|async|declare|accessor)\\s+)*';
const JS_METHOD = new RegExp(`^\\s*${MODIFIERS}(?:(get|set)\\s+)?\\*?\\s*(#?[A-Za-z_$][\\w$]*)\\s*(?:<[^>]*>)?\\s*\\(`);
const JS_ARROW_MEMBER = new RegExp(`^\\s*${MODIFIERS}#?[A-Za-z_$][\\w$]*\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=>`);
const NOT_METHODS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'new', 'super', 'await', 'typeof', 'with']);

const OTHER_PATTERNS: Record<string, Array<{ kind: string; regex: RegExp }>> = {
  py: [
    { kind: 'def', regex: /^\s*(?:async\s+)?def\s+\w+/ },
    { kind: 'class', regex: /^\s*class\s+\w+/ },
  ],
  go: [
    { kind: 'func', regex: /^func\b/ },
    { kind: 'type', regex: /^type\s+\w+\s+(?:struct|interface)\b/ },
  ],
  rs: [
    { kind: 'fn', regex: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+\w+/ },
    { kind: 'struct/enum/trait', regex: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|mod)\s+\w+/ },
    { kind: 'impl', regex: /^\s*impl\b/ },
  ],
};

/** Declaration lines found by patterns: a first index when no parser is available. */
function outlineWithPatterns(file: string, content: string): OutlineSymbol[] {
  const lines = content.split('\n');
  const ext = path.extname(file).slice(1).toLowerCase();
  const symbols: OutlineSymbol[] = [];
  const push = (i: number, kind: string, depth: number) => symbols.push({ line: i + 1, kind, signature: tidy(lines[i]), depth });

  if (JS_LIKE.test(file)) {
    const { depth, code } = braceDepths(lines);
    const classes: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!code[i] || !lines[i].trim()) continue;
      while (classes.length && depth[i] <= classes[classes.length - 1]) classes.pop();
      const inClass = classes.length > 0 && depth[i] === classes[classes.length - 1] + 1;
      if (inClass) {
        const m = JS_METHOD.exec(lines[i]);
        if (m && !NOT_METHODS.has(m[2])) { push(i, m[2] === 'constructor' ? 'constructor' : m[1] === 'get' ? 'getter' : m[1] === 'set' ? 'setter' : 'method', classes.length); continue; }
        if (JS_ARROW_MEMBER.test(lines[i])) { push(i, 'method', classes.length); continue; }
      }
      // Top-level and namespace declarations only: local helpers inside functions are noise.
      if (depth[i] > classes.length && !inClass) continue;
      const pattern = JS_PATTERNS.find((p) => p.regex.test(lines[i]));
      if (!pattern) continue;
      push(i, pattern.kind, classes.length);
      if (pattern.kind === 'class') classes.push(depth[i]);
    }
    return symbols;
  }

  const patterns = OTHER_PATTERNS[ext] ?? Object.values(OTHER_PATTERNS).flat();
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || /^(\/\/|#(?!\[)|\/\*|\*)/.test(trimmed)) continue;
    const pattern = patterns.find((p) => p.regex.test(lines[i]));
    if (pattern) push(i, pattern.kind, /^\s/.test(lines[i]) ? 1 : 0);
  }
  return symbols;
}

/** The outline of some source text; `typescript: null` forces the pattern outline. */
export function outlineSource(file: string, content: string, options: { typescript?: TS | null } = {}): { symbols: OutlineSymbol[]; parser: 'typescript' | 'patterns' } {
  const ts = options.typescript !== undefined ? options.typescript : JS_LIKE.test(file) ? loadTypeScript() : null;
  if (ts && JS_LIKE.test(file)) {
    try {
      return { symbols: outlineWithTypeScript(ts, file, content), parser: 'typescript' };
    } catch {}
  }
  return { symbols: outlineWithPatterns(file, content), parser: 'patterns' };
}

export async function outlineFile(
  filePath: string,
  cwd: string,
  extraDirs: string[] = []
): Promise<{ outline: string; count: number; totalLines: number }> {
  const full = assertReadable(filePath, cwd, extraDirs);

  const stat = await fs.stat(full);
  if (stat.isDirectory()) {
    throw new Error(`Cannot outline a directory: ${filePath}. Use list_directory instead.`);
  }

  const buf = await fs.readFile(full);
  if (isProbablyBinary(buf)) {
    throw new Error(`Cannot outline binary file: ${filePath}`);
  }

  const content = buf.toString('utf8');
  const totalLines = content.split('\n').length;
  const { symbols, parser } = outlineSource(full, content);

  const rel = path.relative(cwd, full).split(path.sep).join('/') || filePath;
  if (symbols.length === 0) {
    return {
      outline: `No symbols (classes, functions, types) found in ${rel} (${totalLines} lines).\nUse read_file to inspect its full contents.`,
      count: 0,
      totalLines,
    };
  }

  const body = symbols
    .map((s) => `${'  '.repeat(Math.min(s.depth, 4))}${s.endLine && s.endLine !== s.line ? `${s.line}-${s.endLine}` : s.line}: [${s.kind}] ${s.signature}`)
    .join('\n');
  const how = parser === 'typescript'
    ? 'line ranges from the TypeScript parser'
    : 'declaration lines found by patterns: a declaration may be missing';
  const header = `Outline of ${rel} (${totalLines} lines, ${symbols.length} symbols; ${how}):\n`;
  return {
    outline: truncateHead(`${header}${body}\n\nRead one symbol with read_file(file_path, offset=<first line>, limit=<line count>).`, LIMITS.toolResult),
    count: symbols.length,
    totalLines,
  };
}
