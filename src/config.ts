import type { AutoModeSettings } from './permissions/autoMode.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { CONFIG_DIR_NAME } from './branding.js';
import type { PermissionMode } from './agent/types.js';
import type { HooksConfig } from './hooks/runner.js';
import type { ThinkingLevelSetting } from './agent/thinking.js';

dotenv.config();

export const DEFAULT_MODEL = 'gemini-3.6-flash';
export const DEFAULT_CONTEXT_WINDOW = 1_048_576;

export type NotificationSetting = 'off' | 'permission' | 'all';

export interface Settings {
  permissions?: {
    allow?: string[];
    /** Rules that always prompt, even when an allow rule or the mode would allow. */
    ask?: string[];
    deny?: string[];
    additionalDirectories?: string[];
    defaultMode?: PermissionMode;
  };
  model?: string;
  thinkingLevel?: ThinkingLevelSetting;
  theme?: string;
  contextWindow?: number;
  autoCompact?: boolean;
  autoCompactThreshold?: number;
  /** Auto mode: the user's rules and disabled built-in groups. */
  autoMode?: AutoModeSettings;
  /** Have the model answer after a `!` command (Claude Code does); default true. */
  replyAfterShell?: boolean;
  notifications?: NotificationSetting;
  spinnerVerbs?: string[];
  bashTimeoutMs?: number;
  maxTurns?: number;
  env?: Record<string, string>;
  /** Custom status line: a shell command fed a JSON status on stdin (Claude Code compatible). */
  statusLine?: { type?: 'command'; command: string; padding?: number; refreshInterval?: number };
  /** Lifecycle hooks (Claude Code compatible contract), merged per event across settings files. */
  hooks?: HooksConfig;
}

export interface AppConfig {
  apiKey: string;
  model: string;
  thinkingLevel?: ThinkingLevelSetting;
  workspaceDir: string;
  permissionMode: PermissionMode;
  additionalDirectories: string[];
  settings: Settings;
  contextWindow: number;
  autoCompact: boolean;
  autoCompactThreshold: number;
  notifications: NotificationSetting;
  bashTimeoutMs: number;
  maxTurns: number;
  /** Headless (-p) mode. */
  headless: boolean;
}

export function userConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

export function projectConfigDir(workspaceDir: string): string {
  return path.join(workspaceDir, CONFIG_DIR_NAME);
}

export interface SettingsSource {
  scope: 'user' | 'project' | 'local';
  file: string;
  settings: Settings;
}

function readJson(file: string): Settings | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Settings;
  } catch {
    return null;
  }
}

export function settingsFiles(workspaceDir: string): Array<{ scope: SettingsSource['scope']; file: string }> {
  return [
    { scope: 'user', file: path.join(userConfigDir(), 'settings.json') },
    { scope: 'project', file: path.join(projectConfigDir(workspaceDir), 'settings.json') },
    { scope: 'local', file: path.join(projectConfigDir(workspaceDir), 'settings.local.json') },
  ];
}

export function loadSettingsSources(workspaceDir: string): SettingsSource[] {
  return settingsFiles(workspaceDir)
    .map((s) => ({ ...s, settings: readJson(s.file) }))
    .filter((s): s is SettingsSource => s.settings !== null);
}

export function mergeSettings(sources: Settings[]): Settings {
  const merged: Settings = {};
  for (const s of sources) {
    const { permissions, env, hooks, ...rest } = s;
    Object.assign(merged, rest);
    if (hooks && typeof hooks === 'object') {
      const target: HooksConfig = { ...(merged.hooks ?? {}) };
      for (const [event, groups] of Object.entries(hooks)) {
        if (!Array.isArray(groups)) continue;
        const key = event as keyof HooksConfig;
        target[key] = [...(target[key] ?? []), ...groups];
      }
      merged.hooks = target;
    }
    if (permissions) {
      merged.permissions = {
        ...merged.permissions,
        ...permissions,
        allow: [...(merged.permissions?.allow ?? []), ...(permissions.allow ?? [])],
        ask: [...(merged.permissions?.ask ?? []), ...(permissions.ask ?? [])],
        deny: [...(merged.permissions?.deny ?? []), ...(permissions.deny ?? [])],
        additionalDirectories: [
          ...(merged.permissions?.additionalDirectories ?? []),
          ...(permissions.additionalDirectories ?? []),
        ],
      };
    }
    if (env) merged.env = { ...merged.env, ...env };
  }
  return merged;
}

export function loadSettings(workspaceDir: string): Settings {
  return mergeSettings(loadSettingsSources(workspaceDir).map((s) => s.settings));
}

/** Sets one user setting (e.g. ['permissions', 'defaultMode']) without touching the others. */
export function saveUserSetting(keys: string[], value: unknown, configDir = userConfigDir()): string {
  const file = path.join(configDir, 'settings.json');
  const current = readJson(file) ?? {};
  let node: Record<string, any> = current;
  for (const key of keys.slice(0, -1)) node = node[key] = typeof node[key] === 'object' && node[key] ? node[key] : {};
  node[keys[keys.length - 1]] = value;
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n', 'utf8');
  return file;
}

/** Save the model used by new sessions without replacing other user settings. */
export function saveDefaultModel(model: string, configDir = userConfigDir(), thinkingLevel?: ThinkingLevelSetting): string {
  const file = path.join(configDir, 'settings.json');
  const current = readJson(file) ?? {};
  current.model = model;
  if (thinkingLevel) current.thinkingLevel = thinkingLevel;
  else delete current.thinkingLevel;
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n', 'utf8');
  return file;
}

/** Append a permission rule to a settings file (creates it if needed). */
export function addPermissionRule(
  workspaceDir: string,
  rule: string,
  list: 'allow' | 'ask' | 'deny' = 'allow',
  scope: SettingsSource['scope'] = 'local'
): string {
  const target = settingsFiles(workspaceDir).find((s) => s.scope === scope)!;
  const current = readJson(target.file) ?? {};
  const permissions = current.permissions ?? {};
  const arr = permissions[list] ?? [];
  if (!arr.includes(rule)) arr.push(rule);
  permissions[list] = arr;
  current.permissions = permissions;
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, JSON.stringify(current, null, 2) + '\n', 'utf8');
  return target.file;
}

export function removePermissionRule(workspaceDir: string, rule: string): boolean {
  let removed = false;
  for (const { file } of settingsFiles(workspaceDir)) {
    const current = readJson(file);
    if (!current?.permissions) continue;
    for (const list of ['allow', 'ask', 'deny'] as const) {
      const arr = current.permissions[list];
      if (arr && arr.includes(rule)) {
        current.permissions[list] = arr.filter((r) => r !== rule);
        removed = true;
      }
    }
    if (removed) fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n', 'utf8');
  }
  return removed;
}

export interface ConfigOverrides {
  apiKey?: string;
  model?: string;
  workspaceDir?: string;
  permissionMode?: PermissionMode;
  additionalDirectories?: string[];
  headless?: boolean;
  maxTurns?: number;
}

export function getConfig(overrides: ConfigOverrides = {}): AppConfig {
  const workspaceDir = path.resolve(overrides.workspaceDir || process.cwd());
  const settings = loadSettings(workspaceDir);
  if (settings.env) {
    for (const [k, v] of Object.entries(settings.env)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
  const apiKey = overrides.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const model = overrides.model || process.env.GEMINI_MODEL || settings.model || DEFAULT_MODEL;
  const permissionMode: PermissionMode =
    overrides.permissionMode || settings.permissions?.defaultMode || 'default';
  const additionalDirectories = [
    ...(settings.permissions?.additionalDirectories ?? []),
    ...(overrides.additionalDirectories ?? []),
  ].map((d) => path.resolve(workspaceDir, d));

  return {
    apiKey,
    model,
    thinkingLevel: settings.thinkingLevel,
    workspaceDir,
    permissionMode,
    additionalDirectories,
    settings,
    contextWindow: settings.contextWindow || Number(process.env.FULLER_CONTEXT_WINDOW) || DEFAULT_CONTEXT_WINDOW,
    autoCompact: settings.autoCompact ?? true,
    autoCompactThreshold: settings.autoCompactThreshold ?? 0.85,
    notifications: settings.notifications ?? 'permission',
    bashTimeoutMs: settings.bashTimeoutMs ?? 120_000,
    maxTurns: overrides.maxTurns ?? settings.maxTurns ?? 50,
    headless: overrides.headless ?? false,
  };
}
