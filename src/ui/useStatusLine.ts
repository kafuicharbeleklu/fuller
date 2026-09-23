import { useEffect, useRef, useState } from 'react';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import type { AgentStatus, PermissionMode, UsageInfo } from '../agent/types.js';
import { APP_VERSION } from '../branding.js';
import { sessionFile } from '../session/store.js';

export interface StatusInput {
  sessionId: string;
  model: string;
  mode: PermissionMode;
  status: AgentStatus;
  usage: UsageInfo;
  startedAt: number;
}

/** JSON handed to the status line command (same shape as Claude Code's, so existing scripts work). */
export function buildStatusJson(config: AppConfig, input: StatusInput): Record<string, unknown> {
  const used = input.usage.promptTokens;
  const max = input.usage.contextWindow;
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return {
    hook_event_name: 'Status',
    session_id: input.sessionId,
    transcript_path: sessionFile(config.workspaceDir, input.sessionId),
    cwd: config.workspaceDir,
    version: APP_VERSION,
    model: { id: input.model, display_name: input.model },
    workspace: { current_dir: config.workspaceDir, project_dir: config.workspaceDir, project_name: path.basename(config.workspaceDir) },
    permission_mode: input.mode,
    agent_status: input.status,
    cost: {
      total_cost_usd: 0,
      total_duration_ms: Date.now() - input.startedAt,
      total_api_calls: input.usage.apiCalls,
      total_tokens: input.usage.cumulativeTokens,
    },
    context_window: {
      total_input_tokens: used,
      total_output_tokens: input.usage.responseTokens,
      context_window_size: max,
      used_percentage: pct,
      remaining_percentage: 100 - pct,
    },
  };
}

export function runStatusCommand(command: string, cwd: string, json: Record<string, unknown>, timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const finish = (v: string | null) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const child = spawn('/bin/bash', ['-c', command], { cwd, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, FULLER: '1' } });
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish(null); }, timeoutMs);
      child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
      child.on('error', () => { clearTimeout(timer); finish(null); });
      child.on('close', (code) => { clearTimeout(timer); finish(code === 0 || out ? out.replace(/\s+$/, '') : null); });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(json));
    } catch {
      finish(null);
    }
  });
}

/** Runs the configured status line command (debounced, optional periodic refresh) and returns its output. */
export function useStatusLine(config: AppConfig, input: StatusInput): string | null {
  const setting = config.settings.statusLine;
  const [text, setText] = useState<string | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const running = useRef(false);
  const key = `${input.model}|${input.mode}|${input.status}|${input.usage.promptTokens}|${input.usage.cumulativeTokens}|${input.sessionId}`;

  useEffect(() => {
    if (!setting?.command) return;
    let cancelled = false;
    const run = async () => {
      if (running.current) return;
      running.current = true;
      const result = await runStatusCommand(setting.command, config.workspaceDir, buildStatusJson(config, inputRef.current));
      running.current = false;
      if (!cancelled && result !== null) setText(result);
    };
    const debounce = setTimeout(run, 300);
    const interval = setting.refreshInterval && setting.refreshInterval > 0 ? setInterval(run, setting.refreshInterval * 1000) : null;
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setting?.command, setting?.refreshInterval]);

  return setting?.command ? text : null;
}
