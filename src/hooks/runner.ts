import { spawn } from 'node:child_process';

/**
 * Hooks: user-defined shell commands run on lifecycle events, with the same
 * contract as Claude Code so existing hook scripts can be reused.
 *
 * settings.json:
 *   "hooks": {
 *     "PreToolUse": [{ "matcher": "Bash|Edit", "hooks": [{ "type": "command", "command": "...", "timeout": 60 }] }]
 *   }
 *
 * Contract: JSON payload on stdin. Exit 0 → stdout may be JSON
 * ({ decision, reason, hookSpecificOutput: { permissionDecision, updatedInput, additionalContext } })
 * or plain text (added as context for UserPromptSubmit/SessionStart). Exit 2 → blocking
 * error, stderr is the reason. Other exit codes → non-blocking error (ignored, logged).
 */
export type HookEvent =
  | 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PermissionRequest' | 'PostToolUse'
  | 'Notification' | 'Stop' | 'PreCompact' | 'SessionEnd';

export const HOOK_EVENTS: HookEvent[] = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Notification', 'Stop', 'PreCompact', 'SessionEnd'];

export interface HookCommand {
  type?: 'command';
  command: string;
  timeout?: number;
}

export interface HookMatcherGroup {
  matcher?: string;
  hooks: HookCommand[];
}

export type HooksConfig = Partial<Record<HookEvent, HookMatcherGroup[]>>;

export interface HookPayload {
  session_id: string;
  transcript_path?: string;
  cwd: string;
  hook_event_name: HookEvent;
  permission_mode?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  prompt?: string;
  message?: string;
  notification_type?: string;
  trigger?: string;
  source?: string;
  reason?: string;
  stop_hook_active?: boolean;
}

export interface HookOutcome {
  /** A hook blocked the action (exit 2 or decision: "block"). */
  blocked: boolean;
  reasons: string[];
  /** PreToolUse / PermissionRequest decision. */
  permission?: 'allow' | 'deny' | 'ask';
  updatedInput?: Record<string, unknown>;
  /** Extra context for the model (additionalContext or plain stdout). */
  context: string[];
  /** Messages for the user (stderr of non-blocking errors, reasons). */
  notices: string[];
  ran: number;
}

export interface HookRunOptions {
  cwd: string;
  timeoutMs?: number;
  onNotice?: (text: string) => void;
}

const EMPTY: HookOutcome = { blocked: false, reasons: [], context: [], notices: [], ran: 0 };

export function matches(matcher: string | undefined, target: string | undefined): boolean {
  if (!matcher || matcher === '*' || matcher.trim() === '') return true;
  if (target === undefined) return true;
  if (matcher === target) return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(target);
  } catch {
    return matcher.split('|').map((m) => m.trim()).includes(target);
  }
}

export function selectHooks(config: HooksConfig | undefined, event: HookEvent, target?: string): HookCommand[] {
  const groups = config?.[event];
  if (!Array.isArray(groups)) return [];
  const out: HookCommand[] = [];
  for (const g of groups) {
    if (!g || !Array.isArray(g.hooks)) continue;
    if (!matches(g.matcher, target)) continue;
    for (const h of g.hooks) if (h && typeof h.command === 'string' && h.command.trim()) out.push(h);
  }
  return out;
}

interface RawResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function runHookCommand(hook: HookCommand, payload: HookPayload, cwd: string, defaultTimeoutMs = 60_000): Promise<RawResult> {
  const timeoutMs = hook.timeout && hook.timeout > 0 ? hook.timeout * 1000 : defaultTimeoutMs;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let done = false;
    const finish = (code: number | null) => { if (!done) { done = true; resolve({ code, stdout, stderr, timedOut }); } };
    try {
      const child = spawn('/bin/bash', ['-c', hook.command], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, FULLER: '1', FULLER_HOOK_EVENT: payload.hook_event_name, CLAUDE_PROJECT_DIR: cwd, FULLER_PROJECT_DIR: cwd },
      });
      const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
      child.on('error', (err) => { clearTimeout(timer); stderr += err.message; finish(127); });
      child.on('close', (code) => { clearTimeout(timer); finish(code); });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(payload));
    } catch (err: any) {
      stderr += err?.message ?? String(err);
      finish(127);
    }
  });
}

function parseJsonOutput(stdout: string): any | null {
  const text = stdout.trim();
  if (!text.startsWith('{')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const PERMISSION_RANK = { deny: 3, ask: 2, allow: 1 } as const;

/** Run every matching hook for an event (in parallel) and merge their outcomes. */
export async function runHooks(config: HooksConfig | undefined, event: HookEvent, payload: HookPayload, options: HookRunOptions, target?: string): Promise<HookOutcome> {
  const hooks = selectHooks(config, event, target);
  if (hooks.length === 0) return { ...EMPTY, context: [], reasons: [], notices: [] };
  const results = await Promise.all(hooks.map((h) => runHookCommand(h, payload, options.cwd, options.timeoutMs)));
  const outcome: HookOutcome = { blocked: false, reasons: [], context: [], notices: [], ran: hooks.length };
  results.forEach((r, i) => {
    const label = `${event} hook (${hooks[i].command.slice(0, 40)}${hooks[i].command.length > 40 ? '…' : ''})`;
    if (r.timedOut) {
      outcome.notices.push(`${label} timed out`);
      return;
    }
    if (r.code === 2) {
      outcome.blocked = true;
      const reason = r.stderr.trim() || r.stdout.trim() || 'blocked by hook';
      outcome.reasons.push(reason);
      return;
    }
    if (r.code !== 0) {
      outcome.notices.push(`${label} exited with ${r.code}${r.stderr.trim() ? `: ${r.stderr.trim().split('\n')[0]}` : ''}`);
      return;
    }
    const json = parseJsonOutput(r.stdout);
    if (!json) {
      const text = r.stdout.trim();
      if (text && (event === 'UserPromptSubmit' || event === 'SessionStart' || event === 'PostToolUse')) outcome.context.push(text);
      return;
    }
    if (json.continue === false) {
      outcome.blocked = true;
      outcome.reasons.push(String(json.stopReason ?? 'stopped by hook'));
    }
    if (json.decision === 'block') {
      outcome.blocked = true;
      outcome.reasons.push(String(json.reason ?? 'blocked by hook'));
    }
    const hso = json.hookSpecificOutput ?? {};
    const decision: string | undefined = hso.permissionDecision ?? hso.decision?.behavior ?? (json.decision === 'approve' ? 'allow' : undefined);
    if (decision === 'allow' || decision === 'deny' || decision === 'ask') {
      if (!outcome.permission || PERMISSION_RANK[decision] > PERMISSION_RANK[outcome.permission]) outcome.permission = decision;
      const reason = hso.permissionDecisionReason ?? hso.decision?.message ?? json.reason;
      if (decision === 'deny' && reason) outcome.reasons.push(String(reason));
    }
    const updated = hso.updatedInput ?? hso.decision?.updatedInput;
    if (updated && typeof updated === 'object') outcome.updatedInput = { ...(outcome.updatedInput ?? {}), ...updated };
    if (typeof hso.additionalContext === 'string' && hso.additionalContext.trim()) outcome.context.push(hso.additionalContext.trim());
    if (json.systemMessage) outcome.notices.push(String(json.systemMessage));
  });
  return outcome;
}

export function describeHooks(config: HooksConfig | undefined): string[] {
  const lines: string[] = [];
  for (const event of HOOK_EVENTS) {
    const groups = config?.[event];
    if (!Array.isArray(groups) || groups.length === 0) continue;
    for (const g of groups) {
      for (const h of g.hooks ?? []) lines.push(`${event}${g.matcher ? ` [${g.matcher}]` : ''}: ${h.command}${h.timeout ? ` (timeout ${h.timeout}s)` : ''}`);
    }
  }
  return lines;
}
