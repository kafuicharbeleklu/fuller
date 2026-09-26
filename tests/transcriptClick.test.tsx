import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { FullscreenTranscript, useTranscriptRows } from '../src/ui/FullscreenTranscript.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import type { TranscriptItem } from '../src/agent/types.js';

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const output = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n');
const items: TranscriptItem[] = [
  { key: 'u', kind: 'user', message: { id: 'u', role: 'user', content: 'run it', timestamp: 0 } },
  { key: 'b', kind: 'tool', messageId: 'm', toolCall: { id: 'b', name: 'execute_bash', args: { command: 'seq 12' }, status: 'completed', startTime: 0, endTime: 1, result: output } as any },
  { key: 't', kind: 'text', messageId: 'm', content: 'Done.', timestamp: 0 },
];

/** The transcript with its click wiring, as App sets it up. */
function Harness({ clickRow }: { clickRow: number | null }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Clicks come after the rows are on screen, as in the app.
  const [click, setClick] = useState<{ id: number; row: number } | undefined>(undefined);
  React.useEffect(() => { if (clickRow === null) return; const t = setTimeout(() => setClick({ id: 1, row: clickRow }), 150); return () => clearTimeout(t); }, [clickRow]);
  const rows = useTranscriptRows({ items, live: null, verbose: false, banner: {} as any, frame: '', permissionOpen: false, width: 60, expanded });
  const toggle = (key: string) => setExpanded((c) => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  return <FullscreenTranscript lines={rows.lines} owners={rows.owners} height={40} width={60} scrollRequest={{ id: 0, direction: 'down' }}
    clickRequest={click} onToggleItem={toggle} />;
}
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));

describe('click to expand a tool result in fullscreen (Claude Code docs, fullscreen#use-the-mouse)', () => {
  it('knows which item each row belongs to: tool rows are clickable, text and prompts are not', async () => {
    let captured: any;
    function Probe() { captured = useTranscriptRows({ items, live: null, verbose: false, banner: {} as any, frame: '', permissionOpen: false, width: 60 }); return null; }
    const screen = render(<ThemeProvider theme={loadTheme('dark')}><Probe /></ThemeProvider>);
    await wait();
    // Completed shell commands are folded into a group ("Ran 1 shell command"): its rows belong to the group.
    const toolRows = captured.lines.map((l: string, i: number) => [plain(l), captured.owners[i]]).filter(([, o]: any) => o === 'group-b-1');
    expect(toolRows.length).toBeGreaterThan(0);
    expect(toolRows.some(([l]: any) => l.includes('Ran 1 shell command'))).toBe(true);
    const promptRow = captured.lines.findIndex((l: string) => plain(l).includes('run it'));
    expect(captured.owners[promptRow]).toBeNull();
    const textRow = captured.lines.findIndex((l: string) => plain(l).includes('Done.'));
    expect(captured.owners[textRow]).toBeNull();
    screen.unmount();
  });

  it('opens the clicked tool result in full, and a click elsewhere does nothing', async () => {
    let captured: any;
    function Probe() { captured = useTranscriptRows({ items, live: null, verbose: false, banner: {} as any, frame: '', permissionOpen: false, width: 60 }); return null; }
    const probe = render(<ThemeProvider theme={loadTheme('dark')}><Probe /></ThemeProvider>);
    await wait();
    const toolRow = captured.owners.indexOf('group-b-1');
    expect(toolRow).toBeGreaterThan(-1);
    const textRow = captured.lines.findIndex((l: string) => plain(l).includes('Done.'));
    probe.unmount();

    const folded = render(<ThemeProvider theme={loadTheme('dark')}><Harness clickRow={null} /></ThemeProvider>);
    await wait();
    expect(plain(folded.lastFrame() || '')).not.toContain('line 12');
    folded.unmount();

    const onText = render(<ThemeProvider theme={loadTheme('dark')}><Harness clickRow={textRow} /></ThemeProvider>);
    await wait(400);
    expect(plain(onText.lastFrame() || '')).not.toContain('line 12');
    onText.unmount();

    const onTool = render(<ThemeProvider theme={loadTheme('dark')}><Harness clickRow={toolRow} /></ThemeProvider>);
    await vi.waitFor(() => expect(plain(onTool.lastFrame() || '')).toContain('line 12'));
    onTool.unmount();
  });
});
