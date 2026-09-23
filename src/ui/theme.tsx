import React, { createContext, useContext } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CONFIG_DIR_NAME } from '../branding.js';

export interface Theme {
  name: string;
  text: string;
  subtle: string;
  accent: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  permission: string;
  promptBorder: string;
  bashBorder: string;
  planMode: string;
  autoAccept: string;
  bypass: string;
  diffAdded: string;
  diffRemoved: string;
  diffAddedBg?: string;
  diffRemovedBg?: string;
  user: string;
  tool: string;
  code: string;
  link: string;
}

const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM ?? '') || process.env.TERM_PROGRAM === 'iTerm.app' || process.env.TERM_PROGRAM === 'vscode' || process.env.WT_SESSION !== undefined;

const dark: Theme = {
  name: 'dark',
  text: 'white',
  subtle: 'gray',
  accent: truecolor ? '#d4a04c' : 'yellow',
  secondary: truecolor ? '#7aa2f7' : 'blue',
  success: truecolor ? '#4fb46a' : 'green',
  warning: truecolor ? '#e0af68' : 'yellow',
  error: truecolor ? '#f7768e' : 'red',
  permission: truecolor ? '#e0af68' : 'yellow',
  promptBorder: truecolor ? '#7c7c7c' : 'gray',
  bashBorder: truecolor ? '#ff79c6' : 'magenta',
  planMode: truecolor ? '#2ac3de' : 'cyan',
  autoAccept: truecolor ? '#bb9af7' : 'magenta',
  bypass: truecolor ? '#f7768e' : 'red',
  diffAdded: truecolor ? '#9ece6a' : 'green',
  diffRemoved: truecolor ? '#f7768e' : 'red',
  diffAddedBg: truecolor ? '#1f3d2a' : undefined,
  diffRemovedBg: truecolor ? '#4a1f2a' : undefined,
  user: 'white',
  tool: 'white',
  code: truecolor ? '#c0caf5' : 'cyan',
  link: truecolor ? '#7aa2f7' : 'blue',
};

const light: Theme = {
  ...dark,
  name: 'light',
  text: 'black',
  subtle: 'gray',
  accent: truecolor ? '#a1620f' : 'yellow',
  secondary: truecolor ? '#2f5bd1' : 'blue',
  success: truecolor ? '#1e7d3a' : 'green',
  warning: truecolor ? '#9a6b00' : 'yellow',
  error: truecolor ? '#c0392b' : 'red',
  permission: truecolor ? '#9a6b00' : 'yellow',
  promptBorder: truecolor ? '#9a9a9a' : 'gray',
  planMode: truecolor ? '#0b7285' : 'cyan',
  autoAccept: truecolor ? '#6f42c1' : 'magenta',
  diffAdded: truecolor ? '#1e7d3a' : 'green',
  diffRemoved: truecolor ? '#c0392b' : 'red',
  diffAddedBg: truecolor ? '#dff5e1' : undefined,
  diffRemovedBg: truecolor ? '#fde2e1' : undefined,
  user: 'black',
  tool: 'black',
  code: truecolor ? '#24292e' : 'blue',
  link: truecolor ? '#0969da' : 'blue',
};

const darkDaltonized: Theme = {
  ...dark,
  name: 'dark-daltonized',
  success: truecolor ? '#4c9be8' : 'blue',
  error: truecolor ? '#f5a623' : 'yellow',
  diffAdded: truecolor ? '#4c9be8' : 'blue',
  diffRemoved: truecolor ? '#f5a623' : 'yellow',
  diffAddedBg: truecolor ? '#1c2f4a' : undefined,
  diffRemovedBg: truecolor ? '#4a3a1c' : undefined,
};

const lightDaltonized: Theme = {
  ...light,
  name: 'light-daltonized',
  success: truecolor ? '#1f5fbf' : 'blue',
  error: truecolor ? '#b35c00' : 'yellow',
  diffAdded: truecolor ? '#1f5fbf' : 'blue',
  diffRemoved: truecolor ? '#b35c00' : 'yellow',
  diffAddedBg: truecolor ? '#dbe8fb' : undefined,
  diffRemovedBg: truecolor ? '#fbe9d6' : undefined,
};

const ansi = (base: Theme, name: string): Theme => ({
  ...base,
  name,
  accent: 'yellow',
  secondary: 'blue',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  permission: 'yellow',
  promptBorder: 'gray',
  bashBorder: 'magenta',
  planMode: 'cyan',
  autoAccept: 'magenta',
  bypass: 'red',
  diffAdded: 'green',
  diffRemoved: 'red',
  diffAddedBg: undefined,
  diffRemovedBg: undefined,
  code: 'cyan',
  link: 'blue',
});

export const BUILT_IN_THEMES: Record<string, Theme> = {
  dark,
  light,
  'dark-daltonized': darkDaltonized,
  'light-daltonized': lightDaltonized,
  'dark-ansi': ansi(dark, 'dark-ansi'),
  'light-ansi': ansi(light, 'light-ansi'),
  monokai: { ...dark, name: 'monokai', accent: truecolor ? '#a6e22e' : 'green', secondary: truecolor ? '#66d9ef' : 'cyan', autoAccept: truecolor ? '#ae81ff' : 'magenta' },
  ocean: { ...dark, name: 'ocean', accent: truecolor ? '#5fafd7' : 'blue', secondary: truecolor ? '#87d7ff' : 'cyan' },
  forest: { ...dark, name: 'forest', accent: truecolor ? '#7fbf7f' : 'green', secondary: truecolor ? '#afd75f' : 'green' },
};

const THEME_FILE = path.join(os.homedir(), CONFIG_DIR_NAME, 'theme.json');

/** Best-effort light/dark detection from COLORFGBG (no OSC round-trip needed). */
export function detectBackground(): 'dark' | 'light' {
  const fgbg = process.env.COLORFGBG;
  if (fgbg) {
    const parts = fgbg.split(';');
    const bg = parseInt(parts[parts.length - 1], 10);
    if (!Number.isNaN(bg)) return bg >= 7 && bg <= 15 ? 'light' : 'dark';
  }
  return 'dark';
}

export function resolveTheme(name?: string): Theme {
  if (!name || name === 'auto') return BUILT_IN_THEMES[detectBackground()];
  return BUILT_IN_THEMES[name] ?? BUILT_IN_THEMES.dark;
}

export function loadTheme(preferred?: string): Theme {
  if (preferred) return resolveTheme(preferred);
  try {
    if (fs.existsSync(THEME_FILE)) {
      const data = JSON.parse(fs.readFileSync(THEME_FILE, 'utf8'));
      const base = resolveTheme(data.name);
      return { ...base, ...(data.overrides ?? {}) };
    }
  } catch {}
  return resolveTheme('auto');
}

export function saveTheme(name: string): void {
  fs.mkdirSync(path.dirname(THEME_FILE), { recursive: true });
  fs.writeFileSync(THEME_FILE, JSON.stringify({ name }, null, 2), 'utf8');
}

export function getThemeNames(): string[] {
  return ['auto', ...Object.keys(BUILT_IN_THEMES)];
}

const ThemeContext = createContext<Theme>(dark);

export const ThemeProvider: React.FC<{ theme: Theme; children: React.ReactNode }> = ({ theme, children }) => (
  <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
);

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
