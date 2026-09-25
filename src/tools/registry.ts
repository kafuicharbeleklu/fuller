import { Type, type FunctionDeclaration } from '@google/genai';
import { executeBash, type BackgroundReady } from './bash.js';
import { desktopAuthentication, needsNativeTerminal, type RunInTerminal } from './nativeTerminal.js';
import { readFile, writeFile, editFile, previewEdit, previewWrite } from './fileOps.js';
import { listDirectory, searchFiles, globFiles, formatSearchOutput } from './search.js';
import { outlineFile } from './outline.js';
import { checkSyntax, syntaxWarning } from './syntaxCheck.js';
import { webFetch } from './web.js';
import { resolveInWorkspace } from './paths.js';
import type { FileTracker } from './fileTracker.js';
import { addMemory, loadMemories, removeMemory } from '../agent/autoMemory.js';
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
    name: 'outline_file',
    description: 'Outline classes, functions, interfaces, types and methods in a source code file with their line numbers. Use this on large files before read_file to locate target code efficiently.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        file_path: { type: Type.STRING, description: 'Relative or absolute path to the file.' },
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
    name: 'agent',
    description: 'Delegate a self-contained task to a subagent that runs in its own context with its own tools and returns a final report. Use for broad codebase exploration, research, or long sub-tasks. The prompt must be complete: the subagent does not see this conversation.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        description: { type: Type.STRING, description: 'Short (3-6 words) description of the task, shown to the user.' },
        prompt: { type: Type.STRING, description: 'Detailed, standalone instructions for the subagent, including what to report back.' },
        subagent_type: { type: Type.STRING, description: 'Subagent type from the system prompt list (default: general-purpose; use Explore for read-only exploration).' },
      },
      required: ['description', 'prompt'],
    },
  },
  {
    name: 'exit_plan_mode',
    description: 'Plan mode only: present your plan to the user and ask to leave plan mode so you can implement it. Call it once the plan is complete; the user approves or asks for changes.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        plan: { type: Type.STRING, description: 'The full plan in Markdown: goal, steps, files to change, verification.' },
      },
      required: ['plan'],
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
    name: 'memory',
    description: 'Keep notes across sessions (learned memory). add: save one fact the user taught you (a correction, a preference, a project convention or constraint the code does not show, an external reference). remove: delete a note by id when it is wrong or outdated. list: show the notes. Never save secrets or things the code already shows.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'add | remove | list' },
        note: { type: Type.STRING, description: 'add: the fact, one per note, useful out of context (include why when known).' },
        type: { type: Type.STRING, description: 'add: feedback (how to work) | preference | project | reference' },
        scope: { type: Type.STRING, description: 'add: project (default) or user (applies to every project).' },
        id: { type: Type.STRING, description: 'remove: the note id shown in the system prompt.' },
      },
      required: ['action'],
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

export const READ_ONLY_TOOLS = new Set(['read_file', 'outline_file', 'list_directory', 'search_files', 'glob', 'skill', 'todo_write', 'task_output', 'task_kill', 'exit_plan_mode', 'agent']);

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
  onBackgroundReady?: BackgroundReady;
  runInTerminal?: RunInTerminal;
  outputFile?: string;
  /** Read-before-edit guard; absent in contexts that do not edit (tests, headless helpers). */
  fileTracker?: FileTracker;
  /** Extra directories read_file may read but nothing may write (Fuller's saved command outputs). */
  readableDirs?: string[];
}

const TODO_STATUSES = new Set(['pending', 'in_progress', 'completed']);

export function normalizeTodos(raw: unknown): TodoItem[] {
  // Seen twice in real sessions (25/09, two models): the previous result's text sent back as the arguments.
  if (!Array.isArray(raw)) throw new Error('todos must be an array of { content, status }, for example {"todos": [{"content": "Run the tests", "status": "in_progress"}, {"content": "Report", "status": "pending"}]}. Send the list itself, not the text of a previous result.');
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
  outputFile?: string;
}

/** Read-before-edit guard: throws Claude Code's message when the file must be (re)read first. */
function guardWrite(filePath: unknown, ctx: ToolContext): string {
  const full = resolveInWorkspace(String(filePath ?? ''), ctx.cwd, ctx.extraDirs);
  const problem = ctx.fileTracker?.check(full);
  if (problem) throw new Error(problem);
  return full;
}

/**
 * Differential syntax check: only an error the edit introduced is reported. An error that was
 * already there (same message) before the edit is the model's or the user's business, not
 * a consequence of this call (Codex, C001).
 */
async function newSyntaxWarning(file: string, previous: string, current: string): Promise<string> {
  const after = await checkSyntax(file, current);
  if (!after) return '';
  const before = previous ? await checkSyntax(file, previous) : null;
  if (before && before.message === after.message) return '';
  return syntaxWarning(after);
}

/** Compute a preview (diff) before asking for permission, without side effects. */
export async function previewTool(name: string, args: Record<string, any>, ctx: ToolContext): Promise<{ diff?: string; error?: string }> {
  try {
    // No permission prompt for an edit that would be refused.
    if (name === 'edit_file' || name === 'write_file') guardWrite(args.file_path, ctx);
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
      if (!command.trim()) throw new Error('command is required.');
      const desktop = desktopAuthentication(command);
      if (desktop) throw new Error(`${desktop}. Run the command with plain sudo instead: Fuller asks for the password in the terminal.`);
      const timeoutMs = Math.min(Number(args.timeout) || ctx.bashTimeoutMs, 600_000);
      if (args.run_in_background) {
        if (ctx.runInTerminal && needsNativeTerminal(command)) throw new Error('Run sudo in the foreground so the user can authenticate in the terminal.');
        if (!ctx.background) throw new Error('Background tasks are not available in this context.');
        const task = ctx.background.start(command, { description: args.description ? String(args.description) : undefined, timeoutMs: Math.max(timeoutMs, 600_000) });
        return {
          output: `Started background task ${task.id} (log: ${task.logFile}). Use task_output("${task.id}") to read its output; you will be notified when it finishes.`,
          summary: `background ${task.id}`,
        };
      }
      const res = await executeBash(command, ctx.cwd, { timeoutMs, signal: ctx.signal, onOutput: ctx.onOutput, outputFile: ctx.outputFile, background: ctx.background, onBackgroundReady: ctx.onBackgroundReady, runInTerminal: ctx.runInTerminal });
      if (res.interrupted) throw new Error('Interrupted');
      if (res.backgroundTaskId) return { output: `Moved running command to background task ${res.backgroundTaskId} (log: ${res.outputFile}). Use task_output to read its output.`, summary: `background ${res.backgroundTaskId}` };
      const parts = [
        res.stdout,
        res.stderr ? (res.stdout ? `\n[stderr]\n${res.stderr}` : res.stderr) : '',
      ].filter(Boolean);
      let out = parts.join('\n');
      if (res.timedOut) out += `\n\n[Command timed out after ${Math.round(timeoutMs / 1000)}s]`;
      if (res.exitCode !== 0) out += `\n\n[Exit code: ${res.exitCode}]`;
      let output = truncateMiddle(out || '(no output)', LIMITS.bashOutput);
      // The whole output is on disk: say where, so the model can read the part it needs.
      if (out.length > LIMITS.bashOutput && res.outputFile) output += `\n\n[Full output saved to ${res.outputFile} — read it with read_file (offset/limit) if you need the part left out.]`;
      const lineCount = (res.stdout + res.stderr).split('\n').filter(Boolean).length;
      return {
        output,
        summary: res.exitCode === 0 ? `${lineCount} line${lineCount === 1 ? '' : 's'} · ${res.durationMs}ms` : `exit ${res.exitCode} · ${res.durationMs}ms`,
        outputFile: res.outputFile,
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
      // Saved command outputs (outside the workspace) may be read too.
      const readDirs = [...ctx.extraDirs, ...(ctx.readableDirs ?? [])];
      const r = await readFile(args.file_path, { ...fileCtx, extraDirs: readDirs }, args.offset, args.limit);
      ctx.fileTracker?.record(resolveInWorkspace(String(args.file_path), ctx.cwd, readDirs));
      return { output: r.content, summary: r.summary };
    }

    case 'outline_file': {
      const res = await outlineFile(String(args.file_path ?? ''), ctx.cwd, ctx.extraDirs);
      return { output: res.outline, summary: `${res.count} symbol${res.count === 1 ? '' : 's'}` };
    }

    case 'write_file': {
      const full = guardWrite(args.file_path, ctx);
      const content = String(args.content ?? '');
      const r = await writeFile(args.file_path, content, fileCtx);
      ctx.fileTracker?.record(full);
      // The file is written as asked; a syntax error is reported right away, not rolled back.
      const warning = await newSyntaxWarning(full, r.previous, content);
      return { output: `${r.summary} (${formatBytes(r.bytesWritten)}).${warning}`, summary: warning ? `${r.summary} · syntax error` : r.summary, diff: r.diff };
    }

    case 'edit_file': {
      const full = guardWrite(args.file_path, ctx);
      const r = await editFile(args.file_path, args.target_content, args.replacement_content, fileCtx, !!args.replace_all);
      ctx.fileTracker?.record(full);
      const warning = await newSyntaxWarning(full, r.previous, r.updated);
      return { output: `${r.message}${warning}`, summary: warning ? `${r.summary} · syntax error` : r.summary, diff: r.diff };
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

    case 'exit_plan_mode':
      return { output: 'Not in plan mode — no approval needed, just proceed.', summary: 'not in plan mode' };

    case 'agent':
      throw new Error('Subagents are not available in this context.');

    case 'skill': {
      const name = String(args.name ?? '').replace(/^\//, '');
      const skill = (ctx.skills ?? []).find((sk) => sk.name === name && sk.modelInvocable);
      if (!skill) throw new Error(`Unknown skill "${name}". Available: ${(ctx.skills ?? []).filter((sk) => sk.modelInvocable).map((sk) => sk.name).join(', ') || 'none'}.`);
      const body = await expandSkill(skill, String(args.args ?? ''), ctx.cwd, { signal: ctx.signal });
      return { output: `# Skill: ${skill.name}\n${skill.description ? `${skill.description}\n` : ''}\n${body}`, summary: `Loaded ${skill.name}` };
    }

    case 'memory': {
      const action = String(args.action ?? 'add');
      if (action === 'list') {
        const entries = loadMemories(ctx.cwd);
        return { output: entries.length ? entries.map((e) => `[${e.id}] (${e.scope} · ${e.type} · ${e.date}) ${e.text}`).join('\n') : 'No notes yet.', summary: `${entries.length} note${entries.length === 1 ? '' : 's'}` };
      }
      if (action === 'remove') {
        const removed = removeMemory(ctx.cwd, String(args.id ?? ''));
        if (!removed) throw new Error(`No note with id "${args.id}".`);
        return { output: `Removed note ${removed.id}: ${removed.text}`, summary: `Forgot: ${removed.text}` };
      }
      const res = addMemory(ctx.cwd, { text: String(args.note ?? ''), type: args.type, scope: args.scope });
      if (res.error) throw new Error(res.error);
      if (res.duplicate) return { output: `Already saved as ${res.duplicate.id}: ${res.duplicate.text}`, summary: 'Already saved' };
      return { output: `Saved note ${res.entry!.id} (${res.entry!.scope} · ${res.entry!.type}).`, summary: `Saved: ${res.entry!.text}` };
    }

    case 'web_fetch': {
      const res = await webFetch(String(args.url ?? ''), { signal: ctx.signal });
      return { output: `HTTP ${res.statusCode} (${res.contentType || 'unknown'})\n\n${res.content}`, summary: `HTTP ${res.statusCode} · ${res.content.length} chars` };
    }

    default:
      throw new Error(name.startsWith('mcp__') ? `MCP tool ${name} is not available (server not connected). Check /mcp.` : `Unknown tool: ${name}`);
  }
}

export function toolLabel(name: string): string {
  switch (name) {
    case 'execute_bash': return 'Bash';
    case 'read_file': return 'Read';
    case 'outline_file': return 'Outline';
    case 'write_file': return 'Write';
    case 'edit_file': return 'Edit';
    case 'list_directory': return 'List';
    case 'search_files': return 'Grep';
    case 'glob': return 'Glob';
    case 'web_fetch': return 'WebFetch';
    case 'memory': return 'Memory';
    case 'skill': return 'Skill';
    case 'todo_write': return 'Update Todos';
    case 'task_output': return 'TaskOutput';
    case 'task_kill': return 'TaskKill';
    case 'exit_plan_mode': return 'ExitPlanMode';
    case 'agent': return 'Agent';
    default: return name;
  }
}

export function toolArgSummary(name: string, args: Record<string, any>): string {
  switch (name) {
    case 'execute_bash': return String(args.command ?? '').split('\n')[0].slice(0, 120);
    case 'read_file': return `${args.file_path}${args.offset ? `:${args.offset}` : ''}${args.limit ? `+${args.limit}` : ''}`;
    case 'outline_file': return String(args.file_path ?? '');
    case 'write_file': return String(args.file_path ?? '');
    case 'edit_file': return String(args.file_path ?? '');
    case 'list_directory': return String(args.dir_path ?? '.');
    case 'search_files': return `pattern: "${args.query}"${args.glob ? `, glob: "${args.glob}"` : ''}${args.path ? `, path: "${args.path}"` : ''}`;
    case 'glob': return `pattern: "${args.pattern}"${args.path ? `, path: "${args.path}"` : ''}`;
    case 'web_fetch': return String(args.url ?? '');
    case 'memory': return args.action === 'remove' ? `forget ${args.id ?? ''}` : args.action === 'list' ? 'list' : String(args.note ?? '').slice(0, 80);
    case 'skill': return `${args.name}${args.args ? ` ${args.args}` : ''}`;
    case 'todo_write': return `${Array.isArray(args.todos) ? args.todos.length : 0} items`;
    case 'task_output': case 'task_kill': return String(args.task_id ?? '');
    case 'exit_plan_mode': return 'plan ready';
    case 'agent': return `${args.subagent_type ? `${args.subagent_type}: ` : ''}${args.description ?? ''}`;
    default: return JSON.stringify(args).slice(0, 100);
  }
}
