import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { SlashMenu, SuggestionList, wrapDescription } from '../src/ui/SlashMenu.js';
import { Footer } from '../src/ui/Footer.js';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import type { SlashCommand } from '../src/ui/commands.js';

const command = (name: string, description: string): SlashCommand => ({ name, description, run: () => {} });
const commands: SlashCommand[] = [
  command('/copy', "Copy Claude's last response to clipboard (or /copy N for the Nth-latest)"),
  command('/color', 'Set the prompt bar color for this session'),
  command('/config', 'Open settings'),
  command('/compact', 'Free up context by summarizing the conversation so far'),
  command('/context', 'Show context usage'),
  command('/cost', 'Show session cost'),
];
const frame = (node: React.ReactNode) => {
  const screen = render(<ThemeProvider theme={loadTheme('dark')}>{node}</ThemeProvider>);
  const text = (screen.lastFrame() || '').split('\n').map((line) => line.trimEnd());
  screen.unmount();
  return text;
};

describe('slash command menu (Claude Code 2.1.281 layout)', () => {
  it('puts descriptions at 40 % of the width, wraps them on two lines and stays within five lines', () => {
    const lines = frame(<SlashMenu commands={commands} selectedIndex={0} width={100} query="co" />);
    expect(lines).toEqual([
      "  /copy                                   Copy Claude's last response to clipboard (or /copy N for",
      '                                          the Nth-latest)',
      '  /color                                  Set the prompt bar color for this session',
      '  /config                                 Open settings',
      '  /compact                                Free up context by summarizing the conversation so far',
    ]);
  });

  it('scrolls to keep the selection visible, without "more" counters or navigation hints', () => {
    const lines = frame(<SlashMenu commands={commands} selectedIndex={5} width={100} />);
    expect(lines.at(-1)).toMatch(/^  \/cost/);
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines.join('\n')).not.toMatch(/more|Navigate/);
  });

  it('truncates long names from the start and descriptions with an ellipsis', () => {
    const lines = frame(<SlashMenu commands={[command('/anthropic-skills:deep-research', 'Use this skill when the user asks for research across multiple sources, comparing options or alternatives')]} selectedIndex={0} width={60} />);
    expect(lines[0]).toMatch(/^  …-skills:deep-research\s+Use this skill/);
    expect(lines[1]).toMatch(/…$/);
    expect(wrapDescription('one two three', 20)).toEqual(['one two three']);
  });

  it('lists @ files with a plus sign and no highlight before navigation', () => {
    const lines = frame(<SuggestionList items={[{ label: '+ src/' }, { label: '+ src/app.ts' }]} selectedIndex={-1} width={80} />);
    expect(lines).toEqual(['  + src/', '  + src/app.ts']);
  });

  it('keeps the mode in the footer while a menu is open', () => {
    const lines = frame(
      <Footer mode="default" status="idle" usage={{ promptTokens: 0, responseTokens: 0, cumulativeTokens: 0, contextWindow: 100000, apiCalls: 0, turns: 0 }}
        autoCompactThreshold={0.85} inputEmpty={false} bashMode={false} menuOpen />,
    );
    expect(lines[0]).toBe('  ⏸ manual mode on');
  });
});

describe('@ file suggestions ranking', () => {
  it('lists only top-level entries for a bare @ and ranks path segments like Claude Code', async () => {
    const { fuzzyFilter } = await import('../src/utils/fileIndex.js');
    const files = ['src/', 'docs/', 'tests/', 'README.md', 'package.json', 'src/app.ts', 'src/utils/', 'src/utils/logger.ts', 'src/components/Button.tsx'];
    expect(fuzzyFilter(files, '')).toEqual(['docs/', 'package.json', 'README.md', 'src/', 'tests/']);
    expect(fuzzyFilter(files, 'ut')).toEqual(['src/utils/', 'src/utils/logger.ts', 'src/components/Button.tsx']);
  });
});
