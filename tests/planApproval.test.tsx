import React from 'react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import { PlanApproval } from '../src/ui/PlanApproval.js';
import { ToolRow } from '../src/ui/ToolRow.js';
import { renderToString } from '../src/ui/renderToString.js';
import { transcriptLines } from '../src/ui/viewerText.js';
import { runCommand } from '../src/ui/commands.js';
import type { PendingConfirmation, PermissionDecision, ToolCallState } from '../src/agent/types.js';

const wrap = (child: React.ReactNode) => <ThemeProvider theme={loadTheme('dark')}>{child}</ThemeProvider>;
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const PLAN = '# Plan: Add hello.txt\n\n1. Create hello.txt.\n2. Write hi into it.';

let home: string;
let savedHome: string | undefined;
let savedEditor: string | undefined;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-plan-'));
  savedHome = process.env.HOME;
  savedEditor = process.env.VISUAL;
  process.env.HOME = home;
  process.env.VISUAL = 'code --wait';
});
afterEach(() => {
  process.env.HOME = savedHome;
  if (savedEditor === undefined) delete process.env.VISUAL; else process.env.VISUAL = savedEditor;
  fs.rmSync(home, { recursive: true, force: true });
});

function confirmation(onDecide: (d: PermissionDecision) => void, plan = PLAN): PendingConfirmation {
  const file = path.join(home, '.fuller', 'plans', 'session.md');
  return {
    toolCall: { id: 't1', name: 'exit_plan_mode', args: { plan }, status: 'confirming' },
    title: 'Fuller has written up a plan and is ready to execute. Would you like to proceed?',
    options: [
      { value: 'yes', label: 'Yes, auto-accept edits', switchMode: 'acceptEdits' },
      { value: 'always', label: 'Yes, manually approve edits', switchMode: 'default' },
      { value: 'no', label: 'No, keep planning' },
    ],
    plan: { text: plan, file },
    onDecide,
  };
}

/** The key listener is attached by an effect after the first frame: wait for it before typing. */
async function ready(screen: ReturnType<typeof render>) {
  await vi.waitFor(() => expect(screen.lastFrame()).toContain('Ready to code?'));
  await tick();
}

describe('plan approval dialog (Claude Code 2.1.283, capture 4.6)', () => {
  it('shows the plan between dashed rules, the three choices and the plan file', async () => {
    const screen = render(wrap(<PlanApproval confirmation={confirmation(() => {})} />));
    await ready(screen);
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('Plan: Add hello.txt'));
    await vi.waitFor(() => expect(screen.lastFrame()).not.toContain('# Plan'));
    const frame = screen.lastFrame() ?? '';
    // marginTop: the dialog starts one blank row down.
    const rows = frame.split('\n').slice(1).map((row) => row.trimEnd());
    expect(rows[0]).toMatch(/^─+$/);
    expect(rows[1]).toBe(' Ready to code?');
    expect(rows[3]).toBe(" Here is Fuller's plan:");
    expect(rows[4]).toMatch(/^╌+$/);
    expect(frame).toContain('Plan: Add hello.txt');
    expect(frame).toContain('2. Write hi into it.');
    expect(frame).toContain(' Fuller has written up a plan and is ready to execute. Would you like to proceed?');
    expect(frame).toContain(' ❯ 1. Yes, auto-accept edits');
    expect(frame).toContain('   2. Yes, manually approve edits');
    expect(frame).toContain('   3. Tell Fuller what to change');
    expect(frame).toContain('      shift+tab to approve with this feedback');
    expect(frame).toContain(' ctrl+g to edit in VS Code · ~/.fuller/plans/session.md');
    screen.unmount();
  });

  it('approves with the first two choices and switches nothing itself', async () => {
    const onDecide = vi.fn();
    const screen = render(wrap(<PlanApproval confirmation={confirmation(onDecide)} />));
    await ready(screen);
    screen.stdin.write('2');
    expect(onDecide).toHaveBeenCalledWith({ kind: 'always', rule: '' });
    screen.unmount();
  });

  it('types the feedback into the third choice; Enter sends it, an empty field does nothing', async () => {
    const onDecide = vi.fn();
    const screen = render(wrap(<PlanApproval confirmation={confirmation(onDecide)} />));
    await ready(screen);
    screen.stdin.write('3');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('❯ 3. Tell Fuller what to change'));
    screen.stdin.write('\r');
    await tick();
    expect(onDecide).not.toHaveBeenCalled();
    screen.stdin.write('add tests');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('❯ 3. add tests'));
    screen.stdin.write('\r');
    expect(onDecide).toHaveBeenCalledWith({ kind: 'no', feedback: 'add tests' });
    screen.unmount();
  });

  it('Shift+Tab approves with the feedback, Esc rejects', async () => {
    const onDecide = vi.fn();
    const screen = render(wrap(<PlanApproval confirmation={confirmation(onDecide)} />));
    await ready(screen);
    screen.stdin.write('\x1b[A');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('❯ 3.'));
    screen.stdin.write('start with tests');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('start with tests'));
    screen.stdin.write('\x1b[Z');
    expect(onDecide).toHaveBeenLastCalledWith({ kind: 'yes', feedback: 'start with tests' });
    screen.stdin.write('\x1b');
    await vi.waitFor(() => expect(onDecide).toHaveBeenLastCalledWith({ kind: 'no' }));
    screen.unmount();
  });

  it('scrolls a plan longer than the room it has with PgUp and PgDn', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `Step ${i + 1}`).join('\n\n');
    const screen = render(wrap(<PlanApproval confirmation={confirmation(() => {}, long)} maxPlanLines={6} />));
    await ready(screen);
    expect(screen.lastFrame()).toContain('Step 1');
    expect(screen.lastFrame()).not.toContain('Step 5');
    expect(screen.lastFrame()).toMatch(/↓ \d+ more lines \(PgDn\)/);
    screen.stdin.write('\x1b[6~');
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('Step 4'));
    expect(screen.lastFrame()).toMatch(/↑ 6 more lines \(PgUp\)/);
    expect(screen.lastFrame()).not.toContain('Step 1\n');
    screen.unmount();
  });
});

describe('plan rows in the transcript', () => {
  const tool = (patch: Partial<ToolCallState>): ToolCallState => ({ id: 't1', name: 'exit_plan_mode', args: { plan: PLAN }, status: 'completed', result: PLAN, planFile: '', ...patch });

  it('"Updated plan · /plan to preview" while waiting, "User approved Fuller\'s plan" once approved', () => {
    const waiting = renderToString(wrap(<ToolRow toolCall={tool({ status: 'confirming' })} verbose={false} permissionOpen />), 80);
    expect(waiting).toContain('● Updated plan');
    expect(waiting).toContain('⎿  /plan to preview');
    const approved = renderToString(wrap(<ToolRow toolCall={tool({ planFile: path.join(os.homedir(), '.fuller', 'plans', 's.md') })} verbose={false} />), 80);
    expect(approved).toContain("● User approved Fuller's plan");
    expect(approved).toContain('⎿  Plan saved to: ~/.fuller/plans/s.md · /plan to edit');
    expect(approved).toContain('Write hi into it.');
  });

  it('a rejected plan sits in a rounded box under "User rejected Fuller\'s plan:"', () => {
    const rejected = renderToString(wrap(<ToolRow toolCall={tool({ status: 'rejected', error: 'add tests' })} verbose={false} />), 80);
    expect(rejected).toContain("⎿  User rejected Fuller's plan:");
    expect(rejected).toMatch(/╭─+╮/);
    expect(rejected).toMatch(/│ .*Write hi into it\./);
    expect(rejected).toContain('add tests');
    const text = transcriptLines([{ key: 'k', kind: 'tool', toolCall: tool({ status: 'rejected' }) } as any], false);
    expect(text.slice(0, 2)).toEqual(['● Updated plan', "  ⎿ User rejected Fuller's plan:"]);
  });

  it('keeps the plain row for the no-op call outside plan mode', () => {
    const noop = renderToString(wrap(<ToolRow toolCall={{ id: 't2', name: 'exit_plan_mode', args: { plan: PLAN }, status: 'completed', result: 'Not in plan mode — no approval needed, just proceed.', summary: 'not in plan mode' }} verbose={false} />), 80);
    expect(noop).not.toContain('User approved');
    expect(noop).toContain('ExitPlanMode');
  });
});

describe('/plan (Claude Code 2.1.283)', () => {
  function ctx(mode: string, planFile: string) {
    const said: string[] = [];
    const sent: string[] = [];
    const edited: string[] = [];
    const config = { permissionMode: mode, settings: {} };
    const context = {
      config,
      agent: { planFilePath: planFile, handleUserInput: async (text: string) => { sent.push(text); } },
      setMode: (m: string) => { config.permissionMode = m; },
      addSystem: (t: string) => said.push(t),
      editFile: (f: string) => edited.push(f),
    } as any;
    return { context, config, said, sent, edited };
  }

  it('enables plan mode, sends a description, then shows the plan without leaving plan mode', async () => {
    const file = path.join(home, 'plan.md');
    const first = ctx('default', file);
    await runCommand('/plan', first.context);
    expect(first.config.permissionMode).toBe('plan');
    expect(first.said).toEqual(['Enabled plan mode']);
    const described = ctx('default', file);
    await runCommand('/plan add a login page', described.context);
    expect(described.sent).toEqual(['add a login page']);
    const empty = ctx('plan', file);
    await runCommand('/plan', empty.context);
    expect(empty.config.permissionMode).toBe('plan');
    expect(empty.said).toEqual(['Already in plan mode. No plan written yet.']);
    fs.writeFileSync(file, `${PLAN}\n`);
    const shown = ctx('plan', file);
    await runCommand('/plan', shown.context);
    expect(shown.said[0]).toContain('**Current Plan**');
    expect(shown.said[0]).toContain('Write hi into it.');
    expect(shown.said[0]).toContain('"/plan open" to edit this plan in **VS Code**');
    const open = ctx('plan', file);
    await runCommand('/plan open', open.context);
    expect(open.edited).toEqual([file]);
    expect(open.said).toEqual([`Opened plan in editor: ~/plan.md`]);
  });
});
