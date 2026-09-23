import { describe, expect, it } from 'vitest';
import { buildStatusJson, runStatusCommand } from '../src/ui/useStatusLine.js';
import { getConfig } from '../src/config.js';

describe('status line', () => {
  const config = getConfig({ workspaceDir: process.cwd(), apiKey: 'x', model: 'gemini-3.8-flash' });
  const input = {
    sessionId: 's1',
    model: 'gemini-3.8-flash',
    mode: 'acceptEdits' as const,
    status: 'idle' as const,
    usage: { promptTokens: 250_000, responseTokens: 12, cumulativeTokens: 400_000, contextWindow: 1_000_000, apiCalls: 3, turns: 1 },
    startedAt: Date.now() - 5000,
  };
  it('builds a Claude Code compatible payload', () => {
    const json = buildStatusJson(config, input) as any;
    expect(json.hook_event_name).toBe('Status');
    expect(json.model.id).toBe('gemini-3.8-flash');
    expect(json.workspace.current_dir).toBe(process.cwd());
    expect(json.context_window.used_percentage).toBe(25);
    expect(json.context_window.remaining_percentage).toBe(75);
    expect(json.permission_mode).toBe('acceptEdits');
    expect(json.cost.total_api_calls).toBe(3);
  });
  it('runs the command with the JSON on stdin', async () => {
    const out = await runStatusCommand(
      `python3 -c "import sys,json; d=json.load(sys.stdin); print(d['model']['id'], str(d['context_window']['used_percentage']) + '%')"`,
      process.cwd(),
      buildStatusJson(config, input)
    );
    expect(out).toBe('gemini-3.8-flash 25%');
  });
  it('returns null on failure or timeout', async () => {
    expect(await runStatusCommand('exit 3', process.cwd(), {})).toBeNull();
    expect(await runStatusCommand('sleep 5', process.cwd(), {}, 200)).toBeNull();
  });
});
