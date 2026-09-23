import { Type, type FunctionDeclaration } from '@google/genai';
import { executeBash } from './bash.js';
import { readFile, writeFile, editFile, previewEdit, previewWrite } from './fileOps.js';
import { listDirectory, searchFiles, globFiles, formatSearchOutput } from './search.js';
import { webFetch } from './web.js';
import { LIMITS, truncateMiddle, truncateHead, formatBytes } from './truncate.js';
import type { CheckpointManager } from '../checkpoint/manager.js';
import { expandSkill, type SkillDefinition } from '../skills/loader.js';
import type { TodoItem } from '../agent/types.js';
import { describeTask, type BackgroundTaskManager } from './background.js';

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
        timeout: { type: Type.INTEGER, description: 'Optional timeout in milliseconds (default 120000, max 600000).' },
        run_in_background: { type: Type.BOOLEAN, description: 'Run the command in the background and return a task id immediately (dev servers, long builds). Use task_output to read its output; you are notified when it finishes.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'task_output',
    description: 'Read the output of a background task started with execute_bash(run_in_background=true). Returns new output since the last read.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        task_id: { type: Type.STRING, description: 'Task id, e.g. "bg1".' },
        wait_seconds: { type: Type.INTEGER, description: 'Wait up to N seconds for the task to finish before reading (default 0, max 300).' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'task_kill',
    description: 'Stop a running background task.',
    parameters: {
      type: Type.OBJECT,
      properties: { task_id: { type: Type.STRING, description: 'Task id to stop.' } },
      required: ['task_id'],
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
        output_mode: { type: Type.STRING, description: '"content" (matching lines, default), "files_with_matches" (file paths only) or "count" (matches per file).' },
        context_lines: { type: Type.INTEGER, description: 'Lines of context around each match (content mode).' },
        head_limit: { type: Type.INTEGER, description: 'Only return the first N lines/entries of the output.' },
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
    name: 'todo_write',
    description:
      'Create or update the task list for the current work. Use it for multi-step tasks: list the steps, mark exactly one as in_progress while you work on it, and mark items completed as soon as they are done. The whole list is replaced on each call.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        todos: {
          type: Type.ARRAY,
          description: 'The complete task list.',
          items: {
            type: Type.OBJECT,
            properties: {
              content: { type: Type.STRING, description: 'Short imperative description of the task.' },
              status: { type: Type.STRING, description: 'pending | in_progress | completed' },
              activeForm: { type: Type.STRING, description: 'Present-continuous form shown while in progress, e.g. "Running the tests".' },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
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

export const READ_ONLY_TOOLS = new Set(['read_file', 'list_directory', 'search_files', 'glob', 'skill', 'todo_write', 'task_output', 'task_kill']);

export interface ToolContext {
  cwd: string;
  extraDirs: string[];
  checkpointManager?: CheckpointManager;
  signal?: AbortSignal;
  bashTimeoutMs: number;
  messageId?: string;
  skills?: SkillDefinition[];
  setTodos?: (todos: TodoItem[]) => void;
  background?: BackgroundTaskManager;
  /** Streaming output of a foreground command (tail shown live). */
  onOutput?: (chunk: string) => void;
}

const TODO_STATUSES = new Set(['pending', 'in_progress', 'completed']);

export function normalizeTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) throw new Error('todos must be an array of { content, status }.');
  return raw.slice(0, 50).map((t: any, i: number) => {
    const content = String(t?.content ?? '').trim();
    if (!content) throw new Error(`todos[${i}].content is required.`);
    const status = String(t?.status ?? 'pending');
    if (!TODO_STATUSES.has(status)) throw new Error(`todos[${i}].status must be pending, in_progress or completed.`);
    return { content, status: status as TodoItem['status'], activeForm: t?.activeForm ? String(t.activeForm) : undefined };
  });
}

export function formatTodos(todos: TodoItem[]): string {
  return todos.map((t) => `${t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'} ${t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}`).join('\n');
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
      if (args.run_in_background) {
        if (!ctx.background) throw new Error('Background tasks are not available in this context.');
        const task = ctx.background.start(command, { description: args.description ? String(args.description) : undefined, timeoutMs: Math.max(timeoutMs, 600_000) });
        return {
          output: `Started background task ${task.id} (log: ${task.logFile}). Use task_output("${task.id}") to read its output; you will be notified when it finishes.`,
          summary: `background ${task.id}`,
        };
      }
      const res = await executeBash(command, ctx.cwd, { timeoutMs, signal: ctx.signal, onOutput: ctx.onOutput });
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

    case 'task_output': {
      if (!ctx.background) throw new Error('No background task manager.');
      const id = String(args.task_id ?? '');
      const waitSeconds = Math.min(Math.max(0, Number(args.wait_seconds) || 0), 300);
      if (waitSeconds > 0) await ctx.background.wait(id, waitSeconds * 1000);
      const r = ctx.background.read(id);
      if (!r) throw new Error(`Unknown task "${id}". Known tasks: ${ctx.background.list().map((t) => t.id).join(', ') || 'none'}.`);
      return {
        output: `${describeTask(r.task)}\n\n${r.output || '(no new output)'}${r.task.status === 'running' ? '\n\n[still running]' : ''}`,
        summary: `${r.task.status}${r.task.exitCode !== undefined ? ` (exit ${r.task.exitCode})` : ''}`,
      };
    }

    case 'task_kill': {
      if (!ctx.background) throw new Error('No background task manager.');
      const t = ctx.background.kill(String(args.task_id ?? ''));
      if (!t) throw new Error(`Unknown task "${args.task_id}".`);
      return { output: `Task ${t.id} ${t.status === 'killed' ? 'stopped' : `was already ${t.status}`}.`, summary: t.status };
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
        contextLines: args.context_lines,
        signal: ctx.signal,
      });
      const mode = (['content', 'files_with_matches', 'count'].includes(args.output_mode) ? args.output_mode : 'content') as 'content' | 'files_with_matches' | 'count';
      const real = res.matches.filter((m) => !m.context).length;
      return { output: formatSearchOutput(String(args.query), res, mode, args.head_limit), summary: `${real}${res.truncated ? '+' : ''} matches · ${res.backend}` };
    }

    case 'glob': {
      const res = await globFiles(String(args.pattern ?? ''), ctx.cwd, ctx.extraDirs, args.path);
      if (res.files.length === 0) return { output: `No files matching "${args.pattern}".`, summary: '0 files' };
      return {
        output: `${res.files.length}${res.truncated ? '+' : ''} files matching "${args.pattern}":\n${res.files.join('\n')}`,
        summary: `${res.files.length}${res.truncated ? '+' : ''} files`,
      };
    }

    case 'todo_write': {
      const todos = normalizeTodos(args.todos);
      ctx.setTodos?.(todos);
      const done = todos.filter((t) => t.status === 'completed').length;
      const active = todos.filter((t) => t.status === 'in_progress').length;
      return {
        output: `Todos updated (${done}/${todos.length} completed${active ? `, ${active} in progress` : ''}):\n${formatTodos(todos)}`,
        summary: `${done}/${todos.length} completed`,
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
    case 'todo_write': return 'Update Todos';
    case 'task_output': return 'TaskOutput';
    case 'task_kill': return 'TaskKill';
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
    case 'todo_write': return `${Array.isArray(args.todos) ? args.todos.length : 0} items`;
    case 'task_output': case 'task_kill': return String(args.task_id ?? '');
    default: return JSON.stringify(args).slice(0, 100);
  }
}
