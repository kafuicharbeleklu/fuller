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
  /** Background of the words that changed inside a modified line (Claude Code's word diff). */
  diffAddedWordBg?: string;
  diffRemovedWordBg?: string;
  user: string;
  userBg?: string;
  /** The ❯ of a sent message (Claude Code: dim grey on the message background). */
  userPrompt?: string;
  /** Background of a "!" command line. */
  bashBg?: string;
  tool: string;
  code: string;
  link: string;
  /** Colour code blocks with cli-highlight; toggled with ctrl+t in /theme. */
  syntaxHighlighting?: boolean;
}

const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM ?? '') || process.env.TERM_PROGRAM === 'iTerm.app' || process.env.TERM_PROGRAM === 'vscode' || process.env.WT_SESSION !== undefined;

/**
 * The themes Claude Code ships, with its colours (read in the 2.1.283 binary, 26/09): Fuller's
 * `subtle` is Claude Code's `inactive` (hints, descriptions), `userPrompt` its `subtle`, `userBg`
 * its `userMessageBackground`. Like Claude Code, these are always 24-bit colours; the terminal
 * library brings them down to 256 or 16 colours when needed. Fuller keeps its own accent (the
 * spinner, the logo) and the diff colours, already Claude Code's.
 */
const dark: Theme = {
  name: 'dark',
  text: '#ffffff',
  subtle: '#999999',
  accent: '#d4a04c',
  secondary: '#7aa2f7',
  success: '#4eba65',
  warning: '#ffc107',
  error: '#ff6b80',
  permission: '#b1b9f9',
  promptBorder: '#888888',
  bashBorder: '#fd5db1',
  planMode: '#48968c',
  autoAccept: '#af87ff',
  bypass: '#ff6b80',
  diffAdded: '#50c850',
  diffRemoved: '#dc5a5a',
  diffAddedBg: '#022800',
  diffRemovedBg: '#3d0100',
  diffAddedWordBg: '#044700',
  diffRemovedWordBg: '#5c0200',
  user: '#ffffff',
  userBg: '#373737',
  userPrompt: '#505050',
  bashBg: '#413c41',
  tool: '#ffffff',
  code: '#b1b9f9',
  // Claude Code draws links in the terminal's bright blue, underlined.
  link: 'blueBright',
};

const light: Theme = {
  ...dark,
  name: 'light',
  text: '#000000',
  subtle: '#666666',
  accent: '#a1620f',
  secondary: '#2f5bd1',
  success: '#2c7a39',
  warning: '#966c1e',
  error: '#ab2b3f',
  permission: '#5769f7',
  promptBorder: '#999999',
  bashBorder: '#ff0087',
  planMode: '#006666',
  autoAccept: '#8700ff',
  bypass: '#ab2b3f',
  diffAdded: '#1e7d3a',
  diffRemoved: '#c0392b',
  diffAddedBg: '#dff5e1',
  diffRemovedBg: '#fde2e1',
  diffAddedWordBg: '#aee5b6',
  diffRemovedWordBg: '#f9b8b4',
  user: '#000000',
  userBg: '#f0f0f0',
  userPrompt: '#afafaf',
  bashBg: '#faf5fa',
  tool: '#000000',
  code: '#5769f7',
  link: '#0969da',
};

const darkDaltonized: Theme = {
  ...dark,
  name: 'dark-daltonized',
  success: '#3399ff',
  warning: '#ffcc00',
  error: '#ff6666',
  permission: '#99ccff',
  planMode: '#669999',
  bashBorder: '#3399ff',
  bypass: '#ff6666',
  code: '#99ccff',
  diffAdded: '#4c9be8',
  diffRemoved: '#f5a623',
  diffAddedBg: '#1c2f4a',
  diffRemovedBg: '#4a3a1c',
  diffAddedWordBg: '#2b4a75',
  diffRemovedWordBg: '#6e5528',
};

const lightDaltonized: Theme = {
  ...light,
  name: 'light-daltonized',
  success: '#006699',
  warning: '#ff9900',
  error: '#cc0000',
  permission: '#3366ff',
  planMode: '#336666',
  bashBorder: '#0066cc',
  bypass: '#cc0000',
  userBg: '#dcdcdc',
  code: '#3366ff',
  diffAdded: '#1f5fbf',
  diffRemoved: '#b35c00',
  diffAddedBg: '#dbe8fb',
  diffRemovedBg: '#fbe9d6',
  diffAddedWordBg: '#b3cdf5',
  diffRemovedWordBg: '#f5cfa3',
};

/** Claude Code's ANSI themes: the terminal's own 16 colours only. */
const darkAnsi: Theme = {
  ...dark,
  name: 'dark-ansi',
  text: 'whiteBright',
  subtle: 'white',
  accent: 'yellow',
  secondary: 'blue',
  success: 'greenBright',
  warning: 'yellowBright',
  error: 'redBright',
  permission: 'blueBright',
  promptBorder: 'white',
  bashBorder: 'magentaBright',
  planMode: 'cyanBright',
  autoAccept: 'magentaBright',
  bypass: 'redBright',
  diffAdded: 'green',
  diffRemoved: 'red',
  diffAddedBg: undefined,
  diffRemovedBg: undefined,
  diffAddedWordBg: undefined,
  diffRemovedWordBg: undefined,
  user: 'whiteBright',
  userBg: 'blackBright',
  userPrompt: 'white',
  bashBg: 'black',
  tool: 'whiteBright',
  code: 'blueBright',
  link: 'blueBright',
};

const lightAnsi: Theme = {
  ...darkAnsi,
  name: 'light-ansi',
  text: 'black',
  subtle: 'blackBright',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  permission: 'blue',
  promptBorder: 'white',
  bashBorder: 'magenta',
  planMode: 'cyan',
  autoAccept: 'magenta',
  bypass: 'red',
  user: 'black',
  userBg: 'white',
  userPrompt: 'blackBright',
  bashBg: 'whiteBright',
  tool: 'black',
  code: 'blue',
  link: 'blue',
};

// Palettes adapted for terminal contrast from coolors.co. The ANSI branches
// keep these themes usable when the terminal cannot display 24-bit colours.
const lagoon: Theme = {
  ...dark,
  name: 'lagoon',
  text: truecolor ? '#eaf6f8' : 'white',
  subtle: truecolor ? '#a6bbc2' : 'gray',
  accent: truecolor ? '#65c4db' : 'cyan',
  secondary: truecolor ? '#92d9e9' : 'cyan',
  success: truecolor ? '#83d9ae' : 'green',
  warning: truecolor ? '#ffd18a' : 'yellow',
  error: truecolor ? '#ff929b' : 'red',
  permission: truecolor ? '#ffd18a' : 'yellow',
  promptBorder: truecolor ? '#6591a4' : 'blue',
  bashBorder: truecolor ? '#aeb9ed' : 'magenta',
  planMode: truecolor ? '#65c4db' : 'cyan',
  autoAccept: truecolor ? '#83d9ae' : 'green',
  bypass: truecolor ? '#ff929b' : 'red',
  diffAdded: truecolor ? '#83d9ae' : 'green',
  diffRemoved: truecolor ? '#ff929b' : 'red',
  diffAddedBg: truecolor ? '#173a36' : undefined,
  diffRemovedBg: truecolor ? '#432a36' : undefined,
  user: truecolor ? '#eaf6f8' : 'white',
  userBg: truecolor ? '#173847' : undefined,
  tool: truecolor ? '#cbeaf0' : 'white',
  code: truecolor ? '#b6e6ef' : 'cyan',
  link: truecolor ? '#65c4db' : 'blue',
};

const olive: Theme = {
  ...dark,
  name: 'olive',
  text: truecolor ? '#fefae0' : 'white',
  subtle: truecolor ? '#b8bea7' : 'gray',
  accent: truecolor ? '#c8d59a' : 'green',
  secondary: truecolor ? '#e8aaa6' : 'magenta',
  success: truecolor ? '#b6d47d' : 'green',
  warning: truecolor ? '#f0c385' : 'yellow',
  error: truecolor ? '#f2a09c' : 'red',
  permission: truecolor ? '#f0c385' : 'yellow',
  promptBorder: truecolor ? '#929f6b' : 'green',
  bashBorder: truecolor ? '#e8aaa6' : 'magenta',
  planMode: truecolor ? '#b9d6be' : 'cyan',
  autoAccept: truecolor ? '#b6d47d' : 'green',
  bypass: truecolor ? '#f2a09c' : 'red',
  diffAdded: truecolor ? '#b6d47d' : 'green',
  diffRemoved: truecolor ? '#f2a09c' : 'red',
  diffAddedBg: truecolor ? '#293c22' : undefined,
  diffRemovedBg: truecolor ? '#47302c' : undefined,
  user: truecolor ? '#fefae0' : 'white',
  userBg: truecolor ? '#283618' : undefined,
  tool: truecolor ? '#f2edcf' : 'white',
  code: truecolor ? '#e7dcae' : 'yellow',
  link: truecolor ? '#e8aaa6' : 'magenta',
};

const amethyst: Theme = {
  ...dark,
  name: 'amethyst',
  text: truecolor ? '#f5eaf7' : 'white',
  subtle: truecolor ? '#bda9c4' : 'gray',
  accent: truecolor ? '#d8b4e2' : 'magenta',
  secondary: truecolor ? '#cda1c2' : 'magenta',
  success: truecolor ? '#a9d9b2' : 'green',
  warning: truecolor ? '#f2c28b' : 'yellow',
  error: truecolor ? '#f5a1ac' : 'red',
  permission: truecolor ? '#f2c28b' : 'yellow',
  promptBorder: truecolor ? '#a280b0' : 'magenta',
  bashBorder: truecolor ? '#cda1c2' : 'magenta',
  planMode: truecolor ? '#a9cbe7' : 'cyan',
  autoAccept: truecolor ? '#d8b4e2' : 'magenta',
  bypass: truecolor ? '#f5a1ac' : 'red',
  diffAdded: truecolor ? '#a9d9b2' : 'green',
  diffRemoved: truecolor ? '#f5a1ac' : 'red',
  diffAddedBg: truecolor ? '#27382e' : undefined,
  diffRemovedBg: truecolor ? '#482b3c' : undefined,
  user: truecolor ? '#f5eaf7' : 'white',
  userBg: truecolor ? '#352044' : undefined,
  tool: truecolor ? '#eed8f2' : 'white',
  code: truecolor ? '#e4c9ed' : 'magenta',
  link: truecolor ? '#d8b4e2' : 'magenta',
};

const citrus: Theme = {
  ...light,
  name: 'citrus',
  text: truecolor ? '#292c29' : 'black',
  subtle: truecolor ? '#615f54' : 'gray',
  accent: truecolor ? '#9b4e0e' : 'yellow',
  secondary: truecolor ? '#1a628b' : 'blue',
  success: truecolor ? '#216b57' : 'green',
  warning: truecolor ? '#895500' : 'yellow',
  error: truecolor ? '#b33236' : 'red',
  permission: truecolor ? '#895500' : 'yellow',
  promptBorder: truecolor ? '#a87936' : 'yellow',
  bashBorder: truecolor ? '#a84735' : 'red',
  planMode: truecolor ? '#1a628b' : 'blue',
  autoAccept: truecolor ? '#216b57' : 'green',
  bypass: truecolor ? '#b33236' : 'red',
  diffAdded: truecolor ? '#216b57' : 'green',
  diffRemoved: truecolor ? '#b33236' : 'red',
  diffAddedBg: truecolor ? '#dcf2e6' : undefined,
  diffRemovedBg: truecolor ? '#f9dfdd' : undefined,
  user: truecolor ? '#292c29' : 'black',
  userBg: truecolor ? '#fff2bf' : undefined,
  tool: truecolor ? '#292c29' : 'black',
  code: truecolor ? '#554127' : 'yellow',
  link: truecolor ? '#1a628b' : 'blue',
};

export const BUILT_IN_THEMES: Record<string, Theme> = {
  dark,
  light,
  'dark-daltonized': darkDaltonized,
  'light-daltonized': lightDaltonized,
  'dark-ansi': darkAnsi,
  'light-ansi': lightAnsi,
  monokai: { ...dark, name: 'monokai', accent: truecolor ? '#a6e22e' : 'green', secondary: truecolor ? '#66d9ef' : 'cyan', autoAccept: truecolor ? '#ae81ff' : 'magenta' },
  ocean: { ...dark, name: 'ocean', accent: truecolor ? '#5fafd7' : 'blue', secondary: truecolor ? '#87d7ff' : 'cyan' },
  forest: { ...dark, name: 'forest', accent: truecolor ? '#7fbf7f' : 'green', secondary: truecolor ? '#afd75f' : 'green' },
  lagoon,
  olive,
  amethyst,
  citrus,
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
      return { ...base, ...(data.overrides ?? {}), syntaxHighlighting: data.syntaxHighlighting !== false };
    }
  } catch {}
  return resolveTheme('auto');
}

/** The configured theme name, before `auto` is resolved to dark or light. */
export function loadThemeName(preferred?: string): string {
  if (preferred) return preferred;
  try {
    if (fs.existsSync(THEME_FILE)) {
      const name = JSON.parse(fs.readFileSync(THEME_FILE, 'utf8')).name;
      if (typeof name === 'string' && getThemeNames().includes(name)) return name;
    }
  } catch {}
  return 'auto';
}

export function loadSyntaxHighlighting(): boolean {
  try {
    if (fs.existsSync(THEME_FILE)) return JSON.parse(fs.readFileSync(THEME_FILE, 'utf8')).syntaxHighlighting !== false;
  } catch {}
  return true;
}

export function saveTheme(name: string, syntaxHighlighting = loadSyntaxHighlighting()): void {
  fs.mkdirSync(path.dirname(THEME_FILE), { recursive: true });
  fs.writeFileSync(THEME_FILE, JSON.stringify(syntaxHighlighting ? { name } : { name, syntaxHighlighting: false }, null, 2), 'utf8');
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
