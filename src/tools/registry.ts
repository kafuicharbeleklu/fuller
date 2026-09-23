import { Type, type FunctionDeclaration } from '@google/genai';
import { executeBash } from './bash.js';
import { readFile, writeFile, editFile, previewEdit, previewWrite } from './fileOps.js';
import { listDirectory, searchFiles, globFiles, formatSearchOutput } from './search.js';
import { webFetch } from './web.js';
import { LIMITS, truncateMiddle, truncateHead, formatBytes } from './truncate.js';
import type { CheckpointManager } from '../checkpoint/manager.js';
import { expandSkill, type SkillDefinition } from '../skills/loader.js';

export const geminiToolDeclarations: FunctionDeclaration[] = [
  {
    name: 'execute_bash',
    description:
      'Execute a bash command in the workspace directory. Use for builds, tests, git, package managers. Output is truncated beyond 30000 characters. Prefer read_file/search_files/glob for reading and searching files.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: { type: Type.STRING, description: 'The shell command to execute.' },
        description: { type: Type.STRING, description: 'Short (5-10 words) description of what the command does, shown to the user.' },
        timeout: { type: Type.INTEGER, description: 'Optional timeout in milliseconds (max 600000).' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from the workspace. Returns numbered lines. Reads up to 2000 lines; use offset/limit for large files.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        file_path: { type: Type.STRING, description: 'Relative or absolute path to the file.' },
        offset: { type: Type.INTEGER, description: '1-indexed line number to start reading from.' },
        limit: { type: Type.INTEGER, description: 'Maximum number of lines to read.' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create a new file or completely overwrite an existing file. Prefer edit_file for modifying existing files.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        file_path: { type: Type.STRING, description: 'Target file path.' },
        content: { type: Type.STRING, description: 'Full text content to write into the file.' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact block of text inside an existing file. target_content must match exactly (whitespace included) and be unique unless replace_all is true.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        file_path: { type: Type.STRING, description: 'Target file path.' },
        target_content: { type: Type.STRING, description: 'Exact block of text to be replaced.' },
        replacement_content: { type: Type.STRING, description: 'New content to insert in place of target_content.' },
        replace_all: { type: Type.BOOLEAN, description: 'Replace every occurrence (default false).' },
      },
      required: ['file_path', 'target_content', 'replacement_content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and folders in a directory (respects .gitignore).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        dir_path: { type: Type.STRING, description: 'Directory path (defaults to ".").' },
        recursive: { type: Type.BOOLEAN, description: 'List recursively up to 2 levels.' },
      },
    },
  },
  {
    name: 'search_files',
    description: 'Search file contents (grep). Supports regular expressions and a glob filter. Returns file:line: text.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Text or regular expression to search for.' },
        regex: { type: Type.BOOLEAN, description: 'Interpret query as a regular expression (default false).' },
        ignore_case: { type: Type.BOOLEAN, description: 'Case-insensitive search.' },
        glob: { type: Type.STRING, description: 'Restrict to files matching this glob, e.g. "**/*.ts".' },
        path: { type: Type.STRING, description: 'Directory to search in (defaults to workspace).' },
        max_results: { type: Type.INTEGER, description: 'Maximum matches (default 200).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'glob',
    description: 'Find files by glob pattern, sorted by modification time. Example: "src/**/*.tsx".',
    parameters: {
      type: Type.OBJECT,
      properties: {
        pattern: { type: Type.STRING, description: 'Glob pattern to match.' },
        path: { type: Type.STRING, description: 'Base directory (defaults to workspace).' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'skill',
    description: 'Load the instructions of a skill listed in the system prompt (project or user skill). Returns the full instructions to follow for the current task.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Skill name exactly as listed.' },
        args: { type: Type.STRING, description: 'Optional arguments for the skill.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch a web page (http/https) and return its text content (max 20000 characters).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: 'The URL to fetch.' },
      },
      required: ['url'],
    },
  },
];

export const READ_ONLY_TOOLS = new Set(['read_file', 'list_directory', 'search_files', 'glob', 'skill']);

export interface ToolContext {
  cwd: string;
  extraDirs: string[];
  checkpointManager?: CheckpointManager;
  signal?: AbortSignal;
  bashTimeoutMs: number;
  messageId?: string;
  skills?: SkillDefinition[];
}

export interface ToolOutput {
  output: string;
  summary?: string;
  diff?: string;
}

/** Compute a preview (diff) before asking for permission, without side effects. */
export async function previewTool(name: string, args: Record<string, any>, ctx: ToolContext): Promise<{ diff?: string; error?: string }> {
  try {
    if (name === 'edit_file') {
      const p = await previewEdit(args.file_path, args.target_content, args.replacement_content, { cwd: ctx.cwd, extraDirs: ctx.extraDirs }, !!args.replace_all);
      return { diff: p.diff };
    }
    if (name === 'write_file') {
      const p = await previewWrite(args.file_path, String(args.content ?? ''), { cwd: ctx.cwd, extraDirs: ctx.extraDirs });
      return { diff: p.diff };
    }
    return {};
  } catch (err: any) {
    return { error: err.message || String(err) };
  }
}

export async function dispatchTool(name: string, args: Record<string, any>, ctx: ToolContext): Promise<ToolOutput> {
  const fileCtx = { cwd: ctx.cwd, extraDirs: ctx.extraDirs, checkpointManager: ctx.checkpointManager, messageId: ctx.messageId };
  switch (name) {
    case 'execute_bash': {
      const command = String(args.command ?? '');
      if (!command.trim()) throw new Error('command est requis.');
      const timeoutMs = Math.min(Number(args.timeout) || ctx.bashTimeoutMs, 600_000);
      const res = await executeBash(command, ctx.cwd, { timeoutMs, signal: ctx.signal });
      if (res.interrupted) throw new Error('Interrupted');
      const parts = [
        res.stdout,
        res.stderr ? (res.stdout ? `\n[stderr]\n${res.stderr}` : res.stderr) : '',
      ].filter(Boolean);
      let out = parts.join('\n');
      if (res.timedOut) out += `\n\n[Command timed out after ${Math.round(timeoutMs / 1000)}s]`;
      if (res.exitCode !== 0) out += `\n\n[Exit code: ${res.exitCode}]`;
      const output = truncateMiddle(out || '(no output)', LIMITS.bashOutput);
      const lineCount = (res.stdout + res.stderr).split('\n').filter(Boolean).length;
      return {
        output,
        summary: res.exitCode === 0 ? `${lineCount} line${lineCount === 1 ? '' : 's'} · ${res.durationMs}ms` : `exit ${res.exitCode} · ${res.durationMs}ms`,
      };
    }

    case 'read_file': {
      const r = await readFile(args.file_path, fileCtx, args.offset, args.limit);
      return { output: r.content, summary: r.summary };
    }

    case 'write_file': {
      const r = await writeFile(args.file_path, String(args.content ?? ''), fileCtx);
      return { output: `${r.summary} (${formatBytes(r.bytesWritten)}).`, summary: r.summary, diff: r.diff };
    }

    case 'edit_file': {
      const r = await editFile(args.file_path, args.target_content, args.replacement_content, fileCtx, !!args.replace_all);
      return { output: r.message, summary: r.summary, diff: r.diff };
    }

    case 'list_directory': {
      const entries = await listDirectory(args.dir_path || '.', ctx.cwd, !!args.recursive, ctx.extraDirs);
      if (entries.length === 0) return { output: 'Directory is empty.', summary: '0 entries' };
      const output = entries
        .map((e) => (e.isDirectory ? `${e.name}` : `${e.name}${e.size !== undefined ? `  (${formatBytes(e.size)})` : ''}`))
        .join('\n');
      return { output: truncateHead(output, LIMITS.toolResult), summary: `${entries.length} entries` };
    }

    case 'search_files': {
      const res = await searchFiles(String(args.query ?? ''), ctx.cwd, {
        regex: !!args.regex,
        ignoreCase: !!args.ignore_case,
        glob: args.glob,
        path: args.path,
        maxResults: args.max_results,
        extraDirs: ctx.extraDirs,
      });
      return { output: formatSearchOutput(String(args.query), res), summary: `${res.matches.length}${res.truncated ? '+' : ''} matches` };
    }

    case 'glob': {
      const res = await globFiles(String(args.pattern ?? ''), ctx.cwd, ctx.extraDirs, args.path);
      if (res.files.length === 0) return { output: `No files matching "${args.pattern}".`, summary: '0 files' };
      return {
        output: `${res.files.length}${res.truncated ? '+' : ''} files matching "${args.pattern}":\n${res.files.join('\n')}`,
        summary: `${res.files.length}${res.truncated ? '+' : ''} files`,
      };
    }

    case 'skill': {
      const name = String(args.name ?? '').replace(/^\//, '');
      const skill = (ctx.skills ?? []).find((sk) => sk.name === name && sk.modelInvocable);
      if (!skill) throw new Error(`Unknown skill "${name}". Available: ${(ctx.skills ?? []).filter((sk) => sk.modelInvocable).map((sk) => sk.name).join(', ') || 'none'}.`);
      const body = await expandSkill(skill, String(args.args ?? ''), ctx.cwd, { signal: ctx.signal });
      return { output: `# Skill: ${skill.name}\n${skill.description ? `${skill.description}\n` : ''}\n${body}`, summary: `Loaded ${skill.name}` };
    }

    case 'web_fetch': {
      const res = await webFetch(String(args.url ?? ''), { signal: ctx.signal });
      return { output: `HTTP ${res.statusCode} (${res.contentType || 'unknown'})\n\n${res.content}`, summary: `HTTP ${res.statusCode} · ${res.content.length} chars` };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function toolLabel(name: string): string {
  switch (name) {
    case 'execute_bash': return 'Bash';
    case 'read_file': return 'Read';
    case 'write_file': return 'Write';
    case 'edit_file': return 'Edit';
    case 'list_directory': return 'List';
    case 'search_files': return 'Grep';
    case 'glob': return 'Glob';
    case 'web_fetch': return 'WebFetch';
    case 'skill': return 'Skill';
    default: return name;
  }
}

export function toolArgSummary(name: string, args: Record<string, any>): string {
  switch (name) {
    case 'execute_bash': return String(args.command ?? '').split('\n')[0].slice(0, 120);
    case 'read_file': return `${args.file_path}${args.offset ? `:${args.offset}` : ''}${args.limit ? `+${args.limit}` : ''}`;
    case 'write_file': return String(args.file_path ?? '');
    case 'edit_file': return String(args.file_path ?? '');
    case 'list_directory': return String(args.dir_path ?? '.');
    case 'search_files': return `pattern: "${args.query}"${args.glob ? `, glob: "${args.glob}"` : ''}${args.path ? `, path: "${args.path}"` : ''}`;
    case 'glob': return `pattern: "${args.pattern}"${args.path ? `, path: "${args.path}"` : ''}`;
    case 'web_fetch': return String(args.url ?? '');
    case 'skill': return `${args.name}${args.args ? ` ${args.args}` : ''}`;
    default: return JSON.stringify(args).slice(0, 100);
  }
}
