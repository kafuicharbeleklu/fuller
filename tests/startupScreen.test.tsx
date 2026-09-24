import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Banner } from '../src/ui/Banner.js';
import { Footer, PromptHints } from '../src/ui/Footer.js';
import { InputBox } from '../src/ui/InputBox.js';
import { modelLabel } from '../src/ui/modelLabel.js';
import { EXAMPLE_PROMPTS, getPromptSuggestion } from '../src/ui/suggestions.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';

describe('startup screen', () => {
  it('lays out the banner like Claude Code: logo, identity, model and billing, directory, tip', () => {
    const screen = render(
      <ThemeProvider theme={loadTheme('dark')}>
        <Banner
          model="gemini-3.6-flash"
          workspaceDir="/tmp/fuller-startup-project"
          gitBranch="main"
          tip="Use /model to switch models."
          memoryFiles={['/tmp/fuller-startup-project/FULLER.md']}
        />
      </ThemeProvider>
    );
    const lines = (screen.lastFrame() || '').split('\n').map((line) => line.trimEnd());
    expect(lines.slice(0, 10)).toEqual([
      '',
      '  ██████╗  Fuller v0.3.0',
      '  ██╔═══╝  Gemini 3.6 Flash · Gemini API',
      '  █████╗   /tmp/fuller-startup-project',
      '  ██╔══╝',
      '  ██║',
      '  ╚═╝',
      '',
      '  Use /model to switch models.',
      '',
    ]);
    const frame = lines.join('\n');
    expect(frame).not.toContain('Fuller Code');
    expect(frame).not.toContain('main');
    expect(frame).not.toContain('loaded:');
    expect(frame).not.toMatch(/[╭╮╰╯│]/);
    screen.unmount();
  });

  it('shows no line under the banner when there is no tip', () => {
    const screen = render(
      <ThemeProvider theme={loadTheme('dark')}>
        <Banner model="gemini-3.8-flash" workspaceDir="/tmp/p" />
      </ThemeProvider>
    );
    expect((screen.lastFrame() || '').split('\n').map((line) => line.trimEnd()).filter(Boolean)).toHaveLength(6);
    screen.unmount();
  });

  it('wraps the tip instead of truncating it on narrow terminals', () => {
    const screen = render(
      <ThemeProvider theme={loadTheme('dark')}>
        <Banner model="gemini-3.8-flash" workspaceDir="/tmp/p" tip="Shift+Tab alterne les modes : manual → accept edits → plan → bypass." />
      </ThemeProvider>
    );
    expect(screen.lastFrame()).toContain('bypass.');
    screen.unmount();
  });

  it('lays out the footer like Claude Code 2.1.281 in each mode', () => {
    expect(modelLabel('gemini-3.6-flash')).toBe('Gemini 3.6 Flash');
    const usage = { promptTokens: 0, responseTokens: 0, cumulativeTokens: 0, contextWindow: 100000, apiCalls: 0, turns: 0 };
    const footer = (props: Partial<React.ComponentProps<typeof Footer>>) => {
      const screen = render(
        <ThemeProvider theme={loadTheme('dark')}>
          <Footer mode="default" status="idle" usage={usage} autoCompactThreshold={0.85} inputEmpty bashMode={false} {...props} />
        </ThemeProvider>
      );
      const frame = (screen.lastFrame() || '').trimEnd();
      screen.unmount();
      return frame;
    };
    expect(footer({})).toBe('  ⏸ manual mode on · ? for shortcuts · ← for agents');
    expect(footer({ inputEmpty: false })).toBe('  ⏸ manual mode on');
    expect(footer({ mode: 'acceptEdits' })).toBe('  ⏵⏵ accept edits on (shift+tab to cycle) · ← for agents');
    expect(footer({ mode: 'plan' })).toBe('  ⏸ plan mode on (shift+tab to cycle) · ← for agents');
    expect(footer({ bashMode: true })).toBe('  ! for shell mode');
    expect(footer({ hint: 'Press Ctrl-C again to exit' })).toBe('  Press Ctrl-C again to exit');
  });

  it('shows the effort above the prompt, or an input hint in its place', () => {
    const line = (props: Partial<React.ComponentProps<typeof PromptHints>>) => {
      const screen = render(<ThemeProvider theme={loadTheme('dark')}><PromptHints model="gemini-3.6-flash" thinkingLevel="medium" editor="VS Code" {...props} /></ThemeProvider>);
      const frame = (screen.lastFrame() || '').trim();
      screen.unmount();
      return frame;
    };
    expect(line({})).toBe('◐ medium · /effort');
    expect(line({ thinkingLevel: 'high' })).toBe('● high · /effort');
    expect(line({ thinkingLevel: 'low' })).toBe('○ low · /effort');
    expect(line({ multiline: true })).toBe('ctrl+g to edit in VS Code');
    expect(line({ multiline: true, killed: true })).toBe('Ctrl+Y to paste deleted text');
  });

  it('allows empty prompt placeholder or contextual suggestions', () => {
    // Empty placeholder test
    const screenEmpty = render(
      <ThemeProvider theme={loadTheme('dark')}>
        <InputBox
          isActive busy={false} queue={[]} history={[]} cwd={process.cwd()} commands={[]} showHelp={false} placeholder=""
          onSubmit={() => {}} onCommand={() => {}} onBash={() => {}} onInterrupt={() => {}}
          onExit={() => {}} onCycleMode={() => {}} onClearScreen={() => {}} onToggleVerbose={() => {}}
          onToggleHelp={() => {}} onDoubleEscape={() => {}} onPopQueue={() => undefined}
        />
      </ThemeProvider>
    );
    expect(screenEmpty.lastFrame()).not.toContain('Try "');
    screenEmpty.unmount();

    // Contextual suggestion test
    const screenSuggestion = render(
      <ThemeProvider theme={loadTheme('dark')}>
        <InputBox
          isActive busy={false} queue={[]} history={[]} cwd={process.cwd()} commands={[]} showHelp={false}
          placeholder='Try "fix typecheck errors"'
          onSubmit={() => {}} onCommand={() => {}} onBash={() => {}} onInterrupt={() => {}}
          onExit={() => {}} onCycleMode={() => {}} onClearScreen={() => {}} onToggleVerbose={() => {}}
          onToggleHelp={() => {}} onDoubleEscape={() => {}} onPopQueue={() => undefined}
        />
      </ThemeProvider>
    );
    expect(screenSuggestion.lastFrame()).toContain('Try "fix typecheck errors"');
    screenSuggestion.unmount();
  });

  it('computes contextual suggestions based on transcript and git status', () => {
    expect(getPromptSuggestion({}, 'fix lint errors')).toBe('Try "fix lint errors"');
    expect(EXAMPLE_PROMPTS.map((example) => `Try "${example}"`)).toContain(getPromptSuggestion());
    expect(getPromptSuggestion({
      items: [
        { key: 'banner', kind: 'banner' },
        { key: '1', kind: 'tool', messageId: 'm1', toolCall: { id: 't1', name: 'execute_bash', args: {}, status: 'failed', error: 'npm test failed with 2 errors' } },
      ],
    })).toBe('Try "fix the failing test"');

    expect(getPromptSuggestion({
      items: [
        { key: 'banner', kind: 'banner' },
        { key: '1', kind: 'tool', messageId: 'm1', toolCall: { id: 't1', name: 'execute_bash', args: {}, status: 'failed', error: 'TS2304: Cannot find name' } },
      ],
    })).toBe('Try "fix typecheck errors"');
  });
});
