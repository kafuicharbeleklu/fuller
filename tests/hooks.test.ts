import { describe, expect, it } from 'vitest';
import { runHooks, selectHooks, matches, describeHooks, type HooksConfig, type HookPayload } from '../src/hooks/runner.js';

const payload: HookPayload = { session_id: 's', cwd: process.cwd(), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf x' } };
const opts = { cwd: process.cwd(), timeoutMs: 5000 };

describe('hook matching', () => {
  it('matches exact names, regex alternations and wildcards', () => {
    expect(matches('Bash', 'Bash')).toBe(true);
    expect(matches('Bash|Edit', 'Edit')).toBe(true);
    expect(matches('Bash|Edit', 'Read')).toBe(false);
    expect(matches('', 'Read')).toBe(true);
    expect(matches('*', 'Read')).toBe(true);
    expect(matches('Ed.*', 'Edit')).toBe(true);
  });
  it('selects hooks per event and matcher', () => {
    const config: HooksConfig = { PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'a' }] }, { hooks: [{ command: 'b' }] }], Stop: [{ hooks: [{ command: 'c' }] }] };
    expect(selectHooks(config, 'PreToolUse', 'Bash').map((h) => h.command)).toEqual(['a', 'b']);
    expect(selectHooks(config, 'PreToolUse', 'Edit').map((h) => h.command)).toEqual(['b']);
    expect(selectHooks(config, 'Stop').map((h) => h.command)).toEqual(['c']);
    expect(describeHooks(config)).toHaveLength(3);
  });
});

describe('runHooks', () => {
  it('exit 2 blocks with stderr as the reason', async () => {
    const out = await runHooks({ PreToolUse: [{ hooks: [{ command: 'echo "no rm please" >&2; exit 2' }] }] }, 'PreToolUse', payload, opts, 'Bash');
    expect(out.blocked).toBe(true);
    expect(out.reasons).toEqual(['no rm please']);
  });
  it('reads the JSON contract: permission decision, updated input, context', async () => {
    const cmd = `python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': 'allow', 'updatedInput': {'command': d['tool_input']['command'] + ' --dry-run'}, 'additionalContext': 'be careful'}}))"`;
    const out = await runHooks({ PreToolUse: [{ hooks: [{ command: cmd }] }] }, 'PreToolUse', payload, opts, 'Bash');
    expect(out.blocked).toBe(false);
    expect(out.permission).toBe('allow');
    expect(out.updatedInput).toEqual({ command: 'rm -rf x --dry-run' });
    expect(out.context).toEqual(['be careful']);
  });
  it('merges several hooks: deny wins, plain stdout becomes context for prompts', async () => {
    const config: HooksConfig = { UserPromptSubmit: [{ hooks: [{ command: 'echo "remember the style guide"' }, { command: `echo '{"decision":"block","reason":"too vague"}'` }] }] };
    const out = await runHooks(config, 'UserPromptSubmit', { ...payload, hook_event_name: 'UserPromptSubmit', prompt: 'fix it' }, opts);
    expect(out.blocked).toBe(true);
    expect(out.reasons).toEqual(['too vague']);
    expect(out.context).toEqual(['remember the style guide']);
  });
  it('reports non-blocking failures and timeouts as notices', async () => {
    const out = await runHooks({ Stop: [{ hooks: [{ command: 'echo oops >&2; exit 1' }, { command: 'sleep 3', timeout: 1 }] }] }, 'Stop', { ...payload, hook_event_name: 'Stop' }, { ...opts, timeoutMs: 500 });
    expect(out.blocked).toBe(false);
    expect(out.notices.some((n) => n.includes('exited with 1: oops'))).toBe(true);
    expect(out.notices.some((n) => n.includes('timed out'))).toBe(true);
  });
  it('does nothing without configuration', async () => {
    const out = await runHooks(undefined, 'PreToolUse', payload, opts, 'Bash');
    expect(out.ran).toBe(0);
  });
});
