import { afterEach, describe, expect, it, vi } from 'vitest';

const paletteNames = ['lagoon', 'olive', 'amethyst', 'citrus'] as const;

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)!.map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Coolors-inspired themes', () => {
  it('registers complete truecolor themes for command and saved-theme selection', async () => {
    vi.stubEnv('COLORTERM', 'truecolor');
    vi.resetModules();
    const { BUILT_IN_THEMES, getThemeNames, resolveTheme } = await import('../src/ui/theme.js');

    for (const name of paletteNames) {
      const theme = BUILT_IN_THEMES[name];
      expect(getThemeNames()).toContain(name);
      expect(resolveTheme(name)).toBe(theme);
      expect(theme.name).toBe(name);
      for (const role of ['text', 'subtle', 'accent', 'secondary', 'success', 'warning', 'error', 'permission', 'promptBorder', 'bashBorder', 'planMode', 'autoAccept', 'bypass', 'diffAdded', 'diffRemoved', 'diffAddedBg', 'diffRemovedBg', 'user', 'userBg', 'tool', 'code', 'link'] as const) {
        expect(theme[role], `${name}.${role}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    expect(BUILT_IN_THEMES.lagoon.accent).toBe('#65c4db');
    expect(BUILT_IN_THEMES.olive.userBg).toBe('#283618');
    expect(BUILT_IN_THEMES.amethyst.accent).toBe('#d8b4e2');
    expect(BUILT_IN_THEMES.citrus.userBg).toBe('#fff2bf');

    for (const name of paletteNames) {
      const theme = BUILT_IN_THEMES[name];
      const background = theme.userBg!;
      for (const role of ['text', 'subtle', 'accent', 'secondary', 'success', 'warning', 'error', 'user', 'tool', 'code', 'link'] as const) {
        expect(contrast(theme[role], background), `${name}.${role} contrast`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('renders a stable colored terminal preview of each palette', async () => {
    vi.stubEnv('COLORTERM', 'truecolor');
    vi.stubEnv('FORCE_COLOR', '3');
    vi.resetModules();
    const React = await import('react');
    const { Box, Text } = await import('ink');
    const { BUILT_IN_THEMES, ThemeProvider } = await import('../src/ui/theme.js');
    const { renderToString } = await import('../src/ui/renderToString.js');

    for (const name of paletteNames) {
      const theme = BUILT_IN_THEMES[name];
      const preview = React.createElement(ThemeProvider, { theme },
        React.createElement(Box, { flexDirection: 'column' },
          React.createElement(Text, { color: theme.accent }, `${name} accent`),
          React.createElement(Text, { color: theme.subtle }, 'secondary text'),
          React.createElement(Text, { color: theme.success }, 'success'),
          React.createElement(Text, { color: theme.error }, 'error'),
          React.createElement(Text, { color: theme.user, backgroundColor: theme.userBg }, 'user message'),
        ),
      );
      expect(renderToString(preview, 40)).toMatchSnapshot(name);
    }
  });

  it('falls back to ANSI colors and disables custom backgrounds without truecolor', async () => {
    vi.stubEnv('COLORTERM', '');
    vi.stubEnv('TERM_PROGRAM', '');
    vi.stubEnv('WT_SESSION', undefined);
    vi.resetModules();
    const { BUILT_IN_THEMES } = await import('../src/ui/theme.js');

    for (const name of paletteNames) {
      const theme = BUILT_IN_THEMES[name];
      expect(theme.accent).not.toMatch(/^#/);
      expect(theme.userBg).toBeUndefined();
      expect(theme.diffAddedBg).toBeUndefined();
      expect(theme.diffRemovedBg).toBeUndefined();
    }
  });
});
