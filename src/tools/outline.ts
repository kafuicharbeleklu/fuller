import fs from 'node:fs/promises';
import path from 'node:path';
import { assertReadable, resolveInWorkspace } from './paths.js';
import { isProbablyBinary, LIMITS, truncateHead } from './truncate.js';

export interface OutlineSymbol {
  line: number;
  kind: string;
  signature: string;
}

// Language-agnostic regexes for structural symbol declarations
const PATTERNS: Array<{ kind: string; regex: RegExp }> = [
  // TypeScript / JavaScript / JSX / TSX
  { kind: 'function', regex: /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*(\*?\s*[a-zA-Z0-9_$]+(?:\s*<[^>]+>)?\s*\([^)]*\)(?:\s*:\s*[^{;]+)?)/ },
  { kind: 'const-fn', regex: /^\s*(?:export\s+)?(?:const|let)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/ },
  { kind: 'class', regex: /^\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([a-zA-Z0-9_$]+(?:<[^>]+>)?(?:\s+extends\s+[^{]+)?(?:\s+implements\s+[^{]+)?)/ },
  { kind: 'interface', regex: /^\s*(?:export\s+)?interface\s+([a-zA-Z0-9_$]+(?:<[^>]+>)?(?:\s+extends\s+[^{]+)?)/ },
  { kind: 'type', regex: /^\s*(?:export\s+)?type\s+([a-zA-Z0-9_$]+(?:<[^>]+>)?)\s*=/ },
  { kind: 'enum', regex: /^\s*(?:export\s+)?(?:const\s+)?enum\s+([a-zA-Z0-9_$]+)/ },
  // Python
  { kind: 'def', regex: /^\s*(?:async\s+)?def\s+([a-zA-Z0-9_]+(?:\s*\([^)]*\))?(?:\s*->\s*[^:]+)?):/ },
  { kind: 'class', regex: /^\s*class\s+([a-zA-Z0-9_]+(?:\([^)]*\))?):/ },
  // Go
  { kind: 'func', regex: /^\s*func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+(?:\s*\([^)]*\))?(?:\s*[^{]+)?)/ },
  { kind: 'type', regex: /^\s*type\s+([a-zA-Z0-9_]+)\s+(?:struct|interface)/ },
  // Rust
  { kind: 'fn', regex: /^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([a-zA-Z0-9_]+(?:\s*<[^>]+>)?\s*\([^)]*\)(?:\s*->\s*[^{;]+)?)/ },
  { kind: 'struct/enum/trait', regex: /^\s*(?:pub(?:\([^)]+\))?\s+)?(?:struct|enum|trait)\s+([a-zA-Z0-9_]+(?:<[^>]+>)?)/ },
  { kind: 'impl', regex: /^\s*impl(?:\s*<[^>]+>)?\s+(?:[^{]+)\s+for\s+([^{]+)/ },
];

export async function outlineFile(
  filePath: string,
  cwd: string,
  extraDirs: string[] = []
): Promise<{ outline: string; count: number; totalLines: number }> {
  const full = resolveInWorkspace(filePath, cwd, extraDirs);
  assertReadable(full, cwd, extraDirs);

  const stat = await fs.stat(full);
  if (stat.isDirectory()) {
    throw new Error(`Cannot outline a directory: ${filePath}. Use list_directory instead.`);
  }

  const buf = await fs.readFile(full);
  if (isProbablyBinary(buf)) {
    throw new Error(`Cannot outline binary file: ${filePath}`);
  }

  const content = buf.toString('utf8');
  const lines = content.split('\n');
  const totalLines = lines.length;
  const symbols: OutlineSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    for (const pat of PATTERNS) {
      const m = rawLine.match(pat.regex);
      if (m) {
        let sig = m[0].trim();
        // Clean trailing braces or semicolons
        sig = sig.replace(/[\s{;:=]+$/, '').trim();
        symbols.push({
          line: i + 1,
          kind: pat.kind,
          signature: sig,
        });
        break;
      }
    }
  }

  const rel = path.relative(cwd, full).split(path.sep).join('/') || filePath;
  if (symbols.length === 0) {
    return {
      outline: `No symbols (classes, functions, types) found in ${rel} (${totalLines} lines).\nUse read_file to inspect its full contents.`,
      count: 0,
      totalLines,
    };
  }

  const pad = String(totalLines).length;
  const body = symbols
    .map((s) => `${String(s.line).padStart(pad, ' ')}: [${s.kind}] ${s.signature}`)
    .join('\n');

  const header = `Outline of ${rel} (${totalLines} lines, ${symbols.length} symbols):\n`;
  return {
    outline: truncateHead(header + body, LIMITS.toolResult),
    count: symbols.length,
    totalLines,
  };
}
