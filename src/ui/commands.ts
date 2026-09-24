import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { AgentLoop } from '../agent/loop.js';
import { addPermissionRule, removePermissionRule, loadSettingsSources, saveDefaultModel, saveUserSetting, userConfigDir, type AppConfig } from '../config.js';
import { loadProjectContext, memoryFilePath } from '../agent/contextLoader.js';
import { getSystemPrompt } from '../agent/systemPrompt.js';
import { geminiToolDeclarations } from '../tools/registry.js';
import { executeBash } from '../tools/bash.js';
import { listAllSessions, listSessions, formatRelative, sessionsDir, type SessionMeta } from '../session/store.js';
import { loadPromptTimestamps } from '../session/history.js';
import { addMemory, loadMemories, memoryFile } from '../agent/autoMemory.js';
import { quotaBar, usageSummary } from '../agent/quotaText.js';
import { getThemeNames, type Theme } from './theme.js';
import { APP_NAME, APP_VERSION, MEMORY_FILE, CONFIG_DIR_NAME } from '../branding.js';
import type { CommandEntry, ConfigItem, InfoRow, ListItem, SettingsTab } from './InfoDialogs.js';
import { completeDirectory } from './InfoDialogs.js';
import type { Denial } from './PermissionsDialog.js';
import type { ContextData } from './ContextView.js';
import type { ThinkingLevelSetting } from '../agent/thinking.js';
import { contextLabel } from './ModelPicker.js';
import { modelLabel } from './modelLabel.js';
import { formatTokens } from '../tools/truncate.js';
import { listChatModels, formatModelTable, freeTierStatus } from '../agent/models.js';
import { defaultThinkingLevel } from '../agent/thinking.js';
import { PERMISSION_MODES, type MessageKind, type PermissionMode, type UsageInfo } from '../agent/types.js';
import type { GitInfo } from '../utils/git.js';
import { expandSkill, commandPrompt, type SkillDefinition } from '../skills/loader.js';
import { describeHooks } from '../hooks/runner.js';
import { copyToClipboard } from '../utils/clipboard.js';

export interface CommandContext {
  agent: AgentLoop;
  config: AppConfig;
  gitInfo?: GitInfo;
  theme: Theme;
  verbose: boolean;
  usage: UsageInfo;
  startedAt: number;
  addSystem: (text: string, kind?: MessageKind) => void;
  setTheme: (name: string) => void;
  setMode: (mode: PermissionMode) => void;
  cycleMode: () => void;
  clearConversation: () => void;
  exit: () => void;
  openRewind: () => void;
  openDiffViewer: () => void;
  toggleVerbose: () => void;
  transcriptMarkdown: () => string;
  addDir: (dir: string) => void;
  openModelPicker: () => void;
  openThemePicker: () => void;
  openSessionPicker: () => void;
  /** Opens a Claude Code style dialog (/help, /status, /usage). */
  openDialog: (dialog: InfoDialog) => void;
  /** Open a file in $VISUAL/$EDITOR (VS Code when installed), creating it if needed. */
  editFile: (file: string, initialContent?: string) => void;
  /** Effort levels of the current model and the level in use. */
  effort: () => { levels: ThinkingLevelSetting[]; current?: ThinkingLevelSetting };
  setEffort: (level: ThinkingLevelSetting, scope: 'default' | 'session') => void;
  setContextWindow: (tokens: number) => void;
  skills: SkillDefinition[];
  reloadSkills: () => SkillDefinition[];
}

export type InfoDialog =
  | { kind: 'help'; commands: CommandEntry[]; custom: CommandEntry[] }
  | { kind: 'settings'; tab: SettingsTab; status: InfoRow[]; usage: InfoRow[]; config: ConfigItem[]; stats: () => { sessions: SessionMeta[]; prompts: number[] } }
  | { kind: 'btw'; question: string }
  | { kind: 'effort' }
  | { kind: 'input'; title: string; description?: string; label?: string; placeholder?: string; hint?: string; complete?: (value: string) => string; onSubmit: (value: string) => void }
  | { kind: 'list'; title: string; header?: string[]; items: ListItem[]; empty?: string; footer?: string; numbered?: boolean; hint?: string }
  | { kind: 'permissions'; allow: string[]; ask: string[]; deny: string[]; directories: string[]; denials: Denial[]; autoRules: string[]; disabledBuiltin: Array<'softAllow' | 'softDeny'>; onAddRule: (kind: 'allow' | 'ask' | 'deny', rule: string) => void; onRemoveRule: (rule: string) => void; onAddAutoRule: (rule: string) => void; onRemoveAutoRule: (rule: string) => void; onToggleBuiltin: (group: 'softAllow' | 'softDeny') => void; onAddDirectory: () => void };

/** /permissions dialog data; its actions update the settings and reopen it. */
function permissionsDialog(ctx: CommandContext): InfoDialog {
  const perms = ctx.config.settings.permissions ?? {};
  return {
    kind: 'permissions',
    allow: perms.allow ?? [],
    ask: perms.ask ?? [],
    deny: perms.deny ?? [],
    denials: ctx.agent.getRecentDenials(),
    autoRules: ctx.config.settings.autoMode?.rules ?? [],
    disabledBuiltin: ctx.config.settings.autoMode?.disabledBuiltin ?? [],
    onAddAutoRule: (rule) => {
      const auto = ctx.config.settings.autoMode ?? {};
      ctx.config.settings.autoMode = { ...auto, rules: [...(auto.rules ?? []), rule] };
      saveUserSetting(['autoMode', 'rules'], ctx.config.settings.autoMode.rules);
      ctx.openDialog(permissionsDialog(ctx));
    },
    onRemoveAutoRule: (rule) => {
      const auto = ctx.config.settings.autoMode ?? {};
      ctx.config.settings.autoMode = { ...auto, rules: (auto.rules ?? []).filter((r) => r !== rule) };
      saveUserSetting(['autoMode', 'rules'], ctx.config.settings.autoMode.rules);
      ctx.openDialog(permissionsDialog(ctx));
    },
    onToggleBuiltin: (group) => {
      const auto = ctx.config.settings.autoMode ?? {};
      const disabled = auto.disabledBuiltin ?? [];
      ctx.config.settings.autoMode = { ...auto, disabledBuiltin: disabled.includes(group) ? disabled.filter((g) => g !== group) : [...disabled, group] };
      saveUserSetting(['autoMode', 'disabledBuiltin'], ctx.config.settings.autoMode.disabledBuiltin);
      ctx.openDialog(permissionsDialog(ctx));
    },
    directories: [ctx.config.workspaceDir, ...ctx.config.additionalDirectories],
    onAddRule: (kind, rule) => {
      addPermissionRule(ctx.config.workspaceDir, rule, kind);
      const p = ctx.config.settings.permissions ?? {};
      ctx.config.settings.permissions = { ...p, [kind]: [...(p[kind] ?? []), rule] };
      ctx.openDialog(permissionsDialog(ctx));
    },
    onRemoveRule: (rule) => {
      if (removePermissionRule(ctx.config.workspaceDir, rule)) {
        const p = ctx.config.settings.permissions ?? {};
        ctx.config.settings.permissions = { ...p, allow: (p.allow ?? []).filter((r) => r !== rule), ask: (p.ask ?? []).filter((r) => r !== rule), deny: (p.deny ?? []).filter((r) => r !== rule) };
      }
      ctx.openDialog(permissionsDialog(ctx));
    },
    onAddDirectory: () => {
      ctx.openDialog({
        kind: 'input',
        title: 'Add directory to workspace',
        description: `${APP_NAME} will be able to read files in this directory and make edits when auto-accept edits is on.`,
        label: 'Enter the path to the directory:',
        placeholder: 'Directory path…',
        hint: 'Tab to complete · Enter to add · Esc to cancel',
        complete: (value) => completeDirectory(value, ctx.config.workspaceDir, fs, path),
        onSubmit: (value) => {
          const dir = path.resolve(ctx.config.workspaceDir, value);
          if (fs.existsSync(dir)) ctx.addDir(dir);
          ctx.openDialog(permissionsDialog(ctx));
        },
      });
    },
  };
}

/** Hook events in Claude Code's /hooks order, with its descriptions. */
const HOOK_DESCRIPTIONS: Array<[string, string]> = [
  ['PreToolUse', 'Before tool execution'],
  ['PostToolUse', 'After tool execution'],
  ['PermissionRequest', 'When a permission dialog is shown'],
  ['UserPromptSubmit', 'When the user submits a prompt'],
  ['SessionStart', 'When a new session is started'],
  ['SessionEnd', 'When a session is ending'],
  ['Stop', 'Right before the agent concludes its response'],
  ['Notification', 'When notifications are sent'],
  ['PreCompact', 'Before conversation compaction'],
];

const MODE_NAMES: Record<string, string> = { default: 'Default', acceptEdits: 'Accept edits', plan: 'Plan mode', auto: 'Auto' };

/** The Config tab: settings Fuller really has, saved to the user settings. */
function configItems(ctx: CommandContext): ConfigItem[] {
  const { levels, current } = ctx.effort();
  const bool = (value: boolean) => (value ? 'true' : 'false');
  return [
    {
      label: 'Auto-compact', value: bool(ctx.config.autoCompact), options: ['true', 'false'],
      onChange: (value) => { ctx.config.autoCompact = value === 'true'; saveUserSetting(['autoCompact'], ctx.config.autoCompact); },
    },
    levels.length
      ? { label: 'Effort', value: current ?? levels[0], options: levels, onChange: (value) => ctx.setEffort(value as ThinkingLevelSetting, 'default') }
      : { label: 'Effort', value: 'n/a', description: `${modelLabel(ctx.config.model)} has no thinking levels` },
    {
      label: 'Reply after ! commands', value: bool(ctx.config.settings.replyAfterShell !== false), options: ['true', 'false'],
      onChange: (value) => { ctx.config.settings.replyAfterShell = value === 'true'; saveUserSetting(['replyAfterShell'], value === 'true'); },
    },
    {
      // When the model has no key left: ask (Gemini CLI's quota dialog), switch automatically, or stop.
      label: 'Model fallback', value: ctx.config.settings.fallbackModels === 'off' || ctx.config.settings.fallbackModel === 'off' ? 'off' : ctx.config.settings.modelFallback ?? 'ask', options: ['ask', 'auto', 'off'],
      description: 'When the model is out of quota on every key: ask before switching, switch automatically, or stop',
      onChange: (value) => {
        ctx.config.settings.modelFallback = value as 'ask' | 'auto' | 'off';
        if (ctx.config.settings.fallbackModels === 'off') ctx.config.settings.fallbackModels = undefined;
        if (ctx.config.settings.fallbackModel === 'off') ctx.config.settings.fallbackModel = undefined;
        saveUserSetting(['modelFallback'], value);
      },
    },
    {
      label: 'Learned memory', value: bool(ctx.config.settings.autoMemory !== false), options: ['true', 'false'],
      onChange: (value) => { ctx.config.settings.autoMemory = value === 'true'; saveUserSetting(['autoMemory'], value === 'true'); ctx.agent.reloadInstructions(); },
    },
    {
      label: 'Check work before finishing', value: bool(ctx.config.settings.verifyWork !== false), options: ['true', 'false'],
      description: 'Remind the model to test its changes, finish its task list or explain a failed check before it concludes',
      onChange: (value) => { ctx.config.settings.verifyWork = value === 'true'; saveUserSetting(['verifyWork'], value === 'true'); },
    },
    {
      label: 'Review changes', value: ctx.config.settings.reviewChanges ?? 'risky', options: ['risky', 'always', 'off'],
      description: 'A second agent reads the changes before the model concludes: large changes only, every change, or never',
      onChange: (value) => { ctx.config.settings.reviewChanges = value as 'risky' | 'always' | 'off'; saveUserSetting(['reviewChanges'], value); },
    },
    { label: 'Verbose output', value: bool(ctx.verbose), options: ['true', 'false'], onChange: () => ctx.toggleVerbose() },
    {
      label: 'Notifications', value: ctx.config.notifications, options: ['off', 'permission', 'all'],
      onChange: (value) => { ctx.config.notifications = value as AppConfig['notifications']; saveUserSetting(['notifications'], value); },
    },
    {
      label: 'Default permission mode', value: MODE_NAMES[ctx.config.settings.permissions?.defaultMode ?? 'default'] ?? 'Default', options: Object.values(MODE_NAMES),
      onChange: (value) => {
        const mode = Object.keys(MODE_NAMES).find((key) => MODE_NAMES[key] === value) as PermissionMode;
        ctx.config.settings.permissions = { ...ctx.config.settings.permissions, defaultMode: mode };
        saveUserSetting(['permissions', 'defaultMode'], mode);
      },
    },
    { label: 'Theme', value: ctx.theme.name, onOpen: () => ctx.openThemePicker() },
    { label: 'Model', value: modelLabel(ctx.config.model), onOpen: () => ctx.openModelPicker() },
  ];
}

/** The Settings dialog (/status, /config, /usage, /stats) opened on one tab. */
function settingsDialog(ctx: CommandContext, tab: SettingsTab): InfoDialog {
  return {
    kind: 'settings', tab, ...settingsRows(ctx), config: configItems(ctx),
    stats: () => ({ sessions: listAllSessions(Number.MAX_SAFE_INTEGER), prompts: loadPromptTimestamps() }),
  };
}

/** Rows of the Settings dialog, shared by /status and /usage. */
function settingsRows(ctx: CommandContext): { status: InfoRow[]; usage: InfoRow[] } {
  const sources = loadSettingsSources(ctx.config.workspaceDir);
  const memory = loadProjectContext(ctx.config.workspaceDir);
  const allow = ctx.config.settings.permissions?.allow ?? [];
  const deny = ctx.config.settings.permissions?.deny ?? [];
  const u = ctx.usage;
  return {
    status: [
      { label: 'Version', value: APP_VERSION },
      { label: 'Session name', value: ctx.agent.sessionName, placeholder: '/rename to add a name' },
      { label: 'Session ID', value: ctx.agent.sessionId },
      { label: 'cwd', value: `${ctx.config.workspaceDir}${ctx.config.additionalDirectories.length ? ` (+ ${ctx.config.additionalDirectories.join(', ')})` : ''}` },
      { label: 'Model', value: `${modelLabel(ctx.config.model)} (${contextLabel(ctx.config.contextWindow)})${ctx.agent.preferredModel && ctx.agent.preferredModel !== ctx.config.model ? ` · fallback for ${modelLabel(ctx.agent.preferredModel)}` : ''}` },
      // One bar for the model in use, summed over every key (keys themselves are never listed).
      { label: 'Quota', value: `${quotaBar(ctx.agent.quotaUsage().usedFraction)} ${usageSummary(ctx.agent.quotaUsage())}` },
      { label: 'Git', value: ctx.gitInfo?.isGit ? `${ctx.gitInfo.branch}${ctx.gitInfo.isDirty ? ' (dirty)' : ' (clean)'}` : undefined, placeholder: 'not a git repository' },
      { label: 'Permission mode', value: `${ctx.config.permissionMode} · ${allow.length} allow · ${deny.length} deny rules` },
      { label: 'Theme', value: ctx.theme.name },
      { label: 'Memory files', value: memory.map((m) => m.path).join(', ') || undefined, placeholder: `none · /init to create ${MEMORY_FILE}` },
      { label: 'Setting sources', value: sources.map((src) => `${src.scope} (${src.file})`).join(', ') || undefined, placeholder: 'none' },
    ],
    usage: [
      { label: 'Total tokens', value: u.cumulativeTokens.toLocaleString('en-US') },
      { label: 'Last request', value: `${u.promptTokens.toLocaleString('en-US')} prompt · ${u.responseTokens.toLocaleString('en-US')} response` },
      { label: 'API calls', value: `${u.apiCalls} · ${u.turns} tool turns` },
      // Gemini's implicit cache: share of the prompt tokens it served (a stable prompt start raises it).
      { label: 'Cached prompt', value: u.cumulativePromptTokens ? `${Math.round(((u.cumulativeCachedTokens ?? 0) / u.cumulativePromptTokens) * 100)}% · ${(u.cumulativeCachedTokens ?? 0).toLocaleString('en-US')} of ${u.cumulativePromptTokens.toLocaleString('en-US')} tokens` : undefined, placeholder: 'no request yet' },
      { label: 'Total duration', value: fmtDuration(Date.now() - ctx.startedAt) },
      { label: 'Pricing', value: `https://ai.google.dev/pricing (${ctx.config.model})` },
    ],
  };
}

export interface SlashCommand {
  name: string;
  description: string;
  usage?: string;
  takesArg?: boolean;
  aliases?: string[];
  run: (ctx: CommandContext, arg: string) => void | Promise<void>;
}

const fmtDuration = (ms: number) => {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

export const COMMANDS: SlashCommand[] = [
  {
    name: '/help',
    description: 'Show help and available commands',
    run: (ctx) => ctx.openDialog({
      kind: 'help',
      commands: COMMANDS.map((c) => ({ name: c.name, description: c.description })),
      custom: ctx.skills.filter((sk) => sk.userInvocable).map((sk) => ({ name: `/${sk.name}`, description: sk.description ?? '' })),
    }),
  },
  {
    name: '/clear',
    description: 'Start a new conversation with empty context',
    aliases: ['/reset', '/new'],
    run: (ctx) => ctx.clearConversation(),
  },
  {
    name: '/compact',
    description: 'Free up context by summarizing the conversation so far',
    usage: '[focus]',
    takesArg: true,
    run: (ctx, arg) => ctx.agent.compact(arg || undefined),
  },
  {
    name: '/status',
    description: 'Show information about the current session',
    run: (ctx) => ctx.openDialog(settingsDialog(ctx, 'status')),
  },
  {
    name: '/usage',
    description: 'Show token usage and duration of this session',
    aliases: ['/cost'],
    run: (ctx) => ctx.openDialog(settingsDialog(ctx, 'usage')),
  },
  {
    name: '/stats',
    description: 'Show your usage statistics and activity',
    run: (ctx) => ctx.openDialog(settingsDialog(ctx, 'stats')),
  },
  {
    name: '/config',
    description: 'Open settings',
    run: (ctx) => ctx.openDialog(settingsDialog(ctx, 'config')),
  },
  {
    name: '/context',
    description: 'Visualize current context usage as a colored grid',
    run: (ctx) => {
      const sys = getSystemPrompt({ workspaceDir: ctx.config.workspaceDir, model: ctx.config.model, permissionMode: ctx.config.permissionMode });
      const memory = loadProjectContext(ctx.config.workspaceDir);
      const memChars = memory.reduce((a, m) => a + m.content.length, 0);
      const toolChars = JSON.stringify(geminiToolDeclarations).length;
      const msgs = ctx.agent.getMessages().filter((m) => m.kind !== 'context');
      const msgChars = msgs.reduce((a, m) => a + m.content.length + (m.parts ?? []).reduce((b, p) => b + (p.type === 'tool' ? (p.toolCall.result?.length ?? 0) + JSON.stringify(p.toolCall.args).length : p.content.length), 0), 0);
      const skillChars = ctx.skills.reduce((sum, sk) => sum + sk.name.length + (sk.description ?? '').length, 0);
      const tokens = (chars: number) => Math.round(chars / 4);
      // Claude Code 2.1.281 draws this as a coloured grid (ContextView).
      const data: ContextData = {
        modelLabel: `${modelLabel(ctx.config.model)} (${contextLabel(ctx.config.contextWindow)})`,
        modelId: ctx.config.model,
        window: ctx.config.contextWindow,
        bufferShare: Math.max(0, 1 - ctx.config.autoCompactThreshold),
        categories: [
          { name: 'System prompt', tokens: tokens(sys.length - memChars), color: 'promptBorder' },
          { name: 'System tools', tokens: tokens(toolChars), color: 'subtle' },
          { name: 'Memory files', tokens: tokens(memChars), color: 'permission' },
          { name: 'Skills', tokens: tokens(skillChars), color: 'warning' },
          { name: 'Messages', tokens: tokens(msgChars), color: 'autoAccept' },
        ].filter((category) => category.tokens > 0 || category.name === 'Messages') as ContextData['categories'],
        skills: { count: ctx.skills.length, tokens: tokens(skillChars) },
      };
      ctx.addSystem(JSON.stringify(data), 'context');
    },
  },
  {
    name: '/model',
    description: 'Switch the AI model and save it as your default for new sessions',
    usage: '[name|list|list all]',
    takesArg: true,
    run: async (ctx, arg) => {
      if (!arg) { ctx.openModelPicker(); return; }
      if (arg === 'list' || arg === 'list all' || arg === 'all') {
        const all = arg !== 'list';
        const models = await listChatModels(ctx.config.apiKey, { all });
        ctx.addSystem(`**${all ? 'All chat models' : 'Recent, free-of-charge models'} available to this API key** (current: ${ctx.config.model})\n\`\`\`\n${formatModelTable(models)}\n\`\`\`\n${all ? '' : 'See `/model list all` for every model. '}Switch with \`/model <name>\` or set \`GEMINI_MODEL\`.`);
        return;
      }
      const name = arg.trim().replace(/^models\//, '');
      const thinkingLevel = defaultThinkingLevel(name);
      ctx.agent.switchModel(name, thinkingLevel);
      try {
        const known = (await listChatModels(ctx.config.apiKey, { all: true })).find((m) => m.id === name);
        if (known?.inputTokenLimit) ctx.setContextWindow(known.inputTokenLimit);
        if (!known) ctx.addSystem(`⚠ "${name}" is not in the list of chat models for this key (\`/model list all\`). Trying anyway.`, 'notice');
        else if (freeTierStatus(name) === 'paid') ctx.addSystem(`⚠ "${name}" has no free tier (billing required).`, 'notice');
      } catch {}
      let savedDefault = false;
      try {
        saveDefaultModel(name, undefined, thinkingLevel);
        ctx.config.settings.model = name;
        ctx.config.settings.thinkingLevel = thinkingLevel;
        savedDefault = true;
      } catch (err: any) {
        ctx.addSystem(`Could not save the default model: ${err.message || String(err)}. Using it for this session.`, 'notice');
      }
      ctx.addSystem(`Switched model to ${name}${savedDefault ? ' · default for new sessions' : ' · this session only'}. Conversation history kept.`, 'notice');
    },
  },
  {
    name: '/effort',
    description: 'Set the effort level (the levels the model supports); status prints it',
    usage: '[level|status]',
    takesArg: true,
    run: (ctx, arg) => {
      const { levels, current } = ctx.effort();
      if (!levels.length) { ctx.addSystem('The current model has no effort levels.'); return; }
      const value = arg.trim().toLowerCase();
      if (value === 'status') { ctx.addSystem(`Effort level: ${current ?? 'default'}`); return; }
      if (value) {
        if (!levels.includes(value as ThinkingLevelSetting)) { ctx.addSystem(`✗ Unknown effort level "${value}". Choose one of: ${levels.join(', ')}`, 'notice'); return; }
        ctx.setEffort(value as ThinkingLevelSetting, 'default');
        return;
      }
      ctx.openDialog({ kind: 'effort' });
    },
  },
  {
    name: '/keybindings',
    description: 'Open your keyboard shortcuts file',
    run: (ctx) => {
      const file = path.join(userConfigDir(), 'keybindings.json');
      ctx.editFile(file, '{\n  "bindings": {\n    "ctrl+g": "externalEditor"\n  }\n}\n');
      ctx.addSystem(`Opened ${file} · actions: transcript, diff, externalEditor, tasks, redraw, historySearch, undo, cycleMode`);
    },
  },
  {
    name: '/theme',
    description: 'Change the display theme',
    usage: '[name]',
    takesArg: true,
    run: (ctx, arg) => {
      const names = getThemeNames();
      if (!arg) { ctx.openThemePicker(); return; }
      if (!names.includes(arg)) { ctx.addSystem(`Unknown theme "${arg}". Available: ${names.join(', ')}`); return; }
      ctx.setTheme(arg);
      ctx.addSystem(`Theme set to **${arg}**.`);
    },
  },
  {
    name: '/permissions',
    aliases: ['/allowed-tools'],
    description: 'Manage allow and deny rules for tool permissions',
    usage: '[add|remove <rule>]',
    takesArg: true,
    run: (ctx, arg) => {
      const [action, ...rest] = arg.split(/\s+/);
      const rule = rest.join(' ').trim();
      if (action === 'add' && rule) {
        const file = addPermissionRule(ctx.config.workspaceDir, rule);
        ctx.config.settings.permissions = { ...ctx.config.settings.permissions, allow: [...(ctx.config.settings.permissions?.allow ?? []), rule] };
        ctx.addSystem(`Allow rule added: \`${rule}\` → ${file}`);
        return;
      }
      if (action === 'deny' && rule) {
        const file = addPermissionRule(ctx.config.workspaceDir, rule, 'deny');
        ctx.config.settings.permissions = { ...ctx.config.settings.permissions, deny: [...(ctx.config.settings.permissions?.deny ?? []), rule] };
        ctx.addSystem(`Deny rule added: \`${rule}\` → ${file}`);
        return;
      }
      if (action === 'remove' && rule) {
        const ok = removePermissionRule(ctx.config.workspaceDir, rule);
        if (ok) {
          const p = ctx.config.settings.permissions ?? {};
          ctx.config.settings.permissions = { ...p, allow: (p.allow ?? []).filter((r) => r !== rule), ask: (p.ask ?? []).filter((r) => r !== rule), deny: (p.deny ?? []).filter((r) => r !== rule) };
        }
        ctx.addSystem(ok ? `Rule removed: \`${rule}\`` : `Rule not found: \`${rule}\``);
        return;
      }
      // Claude Code opens the Permissions dialog; add/deny/remove stay available as text.
      ctx.openDialog(permissionsDialog(ctx));
    },
  },
  {
    name: '/plan',
    description: 'Enter plan mode directly from the prompt',
    run: (ctx) => {
      const entering = ctx.config.permissionMode !== 'plan';
      ctx.setMode(entering ? 'plan' : 'default');
      ctx.addSystem(entering ? 'Enabled plan mode' : 'Disabled plan mode');
    },
  },
  {
    name: '/accept-edits',
    description: 'Toggle accept edits mode (shift+tab)',
    run: (ctx) => ctx.setMode(ctx.config.permissionMode === 'acceptEdits' ? 'default' : 'acceptEdits'),
  },
  {
    name: '/mode',
    description: 'Set the permission mode',
    usage: `<${PERMISSION_MODES.join('|')}>`,
    takesArg: true,
    run: (ctx, arg) => {
      if (!PERMISSION_MODES.includes(arg as PermissionMode)) { ctx.addSystem(`Usage: \`/mode <${PERMISSION_MODES.join('|')}>\` (current: ${ctx.config.permissionMode})`); return; }
      ctx.setMode(arg as PermissionMode);
    },
  },
  {
    name: '/init',
    description: `Initialize project with a ${MEMORY_FILE} guide`,
    run: (ctx) => {
      const target = memoryFilePath(ctx.config.workspaceDir);
      void ctx.agent.handleUserInput(
        `Analyse ce projet (structure, package.json ou équivalent, README, configuration, scripts de build/test/lint, conventions de code) puis ${fs.existsSync(target) ? `améliore le fichier existant ${path.basename(target)}` : `crée le fichier ${MEMORY_FILE} à la racine`} : un guide concis (max 60 lignes) pour un assistant de développement — commandes de build/test/lint, architecture, conventions, pièges connus. N'invente rien : appuie-toi sur les fichiers lus.`,
        'command'
      );
    },
  },
  {
    name: '/memory',
    description: `Edit ${MEMORY_FILE} files`,
    run: (ctx) => {
      const home = process.env.HOME ?? '';
      const user = path.join(home, CONFIG_DIR_NAME, MEMORY_FILE);
      const project = path.join(ctx.config.workspaceDir, MEMORY_FILE);
      const tilde = (file: string) => (home && file.startsWith(home) ? `~${file.slice(home.length)}` : file);
      const learned = loadMemories(ctx.config.workspaceDir);
      ctx.openDialog({
        kind: 'list',
        title: 'Memory',
        items: [
          { label: 'User instructions', hint: `Saved in ${tilde(user)}`, onSelect: () => ctx.editFile(user) },
          { label: 'Project instructions', hint: `Saved in ./${MEMORY_FILE}`, onSelect: () => ctx.editFile(project) },
          ...(ctx.config.settings.autoMemory === false ? [] : [
            // Notes the agent saved itself (memory tool), per project and for every project.
            { label: `Learned memory (${learned.filter((e) => e.scope === 'project').length})`, hint: `Saved in ${tilde(memoryFile('project', ctx.config.workspaceDir))}`, onSelect: () => ctx.editFile(memoryFile('project', ctx.config.workspaceDir), '# Learned memory\n\n') },
            { label: `Learned memory, all projects (${learned.filter((e) => e.scope === 'user').length})`, hint: `Saved in ${tilde(memoryFile('user', ctx.config.workspaceDir))}`, onSelect: () => ctx.editFile(memoryFile('user', ctx.config.workspaceDir), '# Learned memory\n\n') },
          ]),
        ],
        footer: 'Changes apply on the next message.',
        hint: 'Enter to confirm · Esc to cancel',
      });
    },
  },
  {
    name: '/learn',
    description: 'Save a note or instruction to learned memory',
    usage: '<note>',
    takesArg: true,
    run: (ctx, arg) => {
      const note = (arg ?? '').trim();
      if (!note) {
        ctx.addSystem('Usage: `/learn <instruction, convention or preference>`');
        return;
      }
      const res = addMemory(ctx.config.workspaceDir, { text: note, type: 'feedback', scope: 'project' });
      if (res.error) {
        ctx.addSystem(`✗ Error saving to memory: ${res.error}`);
        return;
      }
      if (res.duplicate) {
        ctx.addSystem(`Note already in memory: "${res.duplicate.text}" [${res.duplicate.id}]`);
        return;
      }
      // The notes live in the system prompt: rebuild it so the next message already sees this one.
      ctx.agent.reloadInstructions();
      ctx.addSystem(ctx.config.settings.autoMemory === false
        ? `✓ Saved to project memory [${res.entry?.id}]: "${res.entry?.text}"\nLearned memory is off (/config → Learned memory): the note is not used until you turn it on.`
        : `✓ Saved to project memory [${res.entry?.id}]: "${res.entry?.text}"\nFuller follows it from your next message, in this session and the next ones.`);
    },
  },
  {
    name: '/rewind',
    description: 'Roll code and conversation back to a checkpoint, or summarize part of the conversation',
    run: (ctx) => ctx.openRewind(),
  },
  {
    name: '/checkpoints',
    description: 'List file checkpoints',
    run: (ctx) => {
      const cps = ctx.agent.getCheckpoints();
      ctx.addSystem(cps.length ? `**Checkpoints**\n${cps.slice(0, 20).map((c) => `- ${new Date(c.timestamp).toLocaleTimeString()} — ${c.description} (${c.files.length} file${c.files.length === 1 ? '' : 's'})`).join('\n')}` : 'No checkpoints yet.');
    },
  },
  {
    name: '/sessions',
    description: 'List the sessions of this project',
    run: (ctx) => {
      const sessions = listSessions(ctx.config.workspaceDir).slice(0, 15);
      ctx.addSystem(
        sessions.length
          ? `**Recent sessions**\n${sessions.map((s) => `- \`${s.id}\` · ${formatRelative(s.updatedAt)} · ${s.messageCount} msgs · ${s.title ?? ''}`).join('\n')}\n\nResume with \`fuller --resume\` (picker) or \`fuller --resume <id>\`; \`fuller --continue\` resumes the latest.`
          : 'No saved sessions for this project yet.'
      );
    },
  },
  {
    name: '/resume',
    description: 'Return to an earlier conversation',
    run: (ctx) => ctx.openSessionPicker(),
  },
  {
    name: '/diff',
    description: 'Review the changes in your working tree',
    run: (ctx) => ctx.openDiffViewer(),
  },
  {
    name: '/export',
    description: 'Export the current conversation',
    usage: '[file]',
    takesArg: true,
    run: (ctx, arg) => {
      const save = (target: string) => {
        const file = path.resolve(ctx.config.workspaceDir, target);
        try {
          fs.writeFileSync(file, ctx.transcriptMarkdown(), 'utf8');
          ctx.addSystem(`Conversation exported to ${file}`);
        } catch (err: any) {
          ctx.addSystem(`✗ Export failed: ${err.message}`, 'notice');
        }
      };
      if (arg) { save(arg); return; }
      // Claude Code asks how to export: clipboard or file.
      ctx.openDialog({
        kind: 'list',
        title: 'Export conversation',
        header: ['Select export method'],
        items: [
          {
            label: 'Copy to clipboard', hint: 'Copy the conversation to your system clipboard',
            onSelect: () => { void copyToClipboard(ctx.transcriptMarkdown()).then((via) => ctx.addSystem(`Conversation copied to the clipboard (${via})`)).catch((err) => ctx.addSystem(`✗ Copy failed: ${err?.message ?? err}`, 'notice')); },
          },
          { label: 'Save to file', hint: 'Save the conversation to a file in the current directory', onSelect: () => save(`fuller-${ctx.agent.sessionId}.md`) },
        ],
        hint: 'Esc to cancel',
      });
    },
  },
  {
    name: '/doctor',
    aliases: ['/checkup'],
    description: 'Run a setup checkup',
    run: (ctx) => {
      const check = (ok: boolean, label: string) => `${ok ? '✔' : '✘'} ${label}`;
      const has = (cmd: string) => { try { execSync(`command -v ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; } };
      const home = process.env.HOME || '';
      const lines = [
        check(!!ctx.config.apiKey, 'GEMINI_API_KEY configured'),
        check(!!ctx.config.model, `model: ${ctx.config.model}`),
        check(fs.existsSync(ctx.config.workspaceDir), `workspace readable: ${ctx.config.workspaceDir}`),
        check(has('git'), 'git available'),
        check(process.stdout.isTTY === true, 'interactive TTY'),
        check(/truecolor|24bit/i.test(process.env.COLORTERM ?? ''), `truecolor (COLORTERM=${process.env.COLORTERM ?? 'unset'})`),
        check(fs.existsSync(memoryFilePath(ctx.config.workspaceDir)), `${MEMORY_FILE} present`),
        check(fs.existsSync(path.join(home, '.fuller')), '~/.fuller directory'),
        `ℹ Node ${process.version} · ${process.platform} · terminal ${process.env.TERM_PROGRAM ?? process.env.TERM ?? 'unknown'} · ${process.stdout.columns}×${process.stdout.rows}`,
      ];
      ctx.addSystem(`**Doctor**\n${lines.join('\n')}`);
    },
  },
  {
    name: '/btw',
    description: 'Ask a side question about the current session without adding to the conversation',
    usage: '<question>',
    takesArg: true,
    run: (ctx, arg) => {
      if (!arg) { ctx.addSystem('Usage: `/btw <question>`'); return; }
      // Claude Code answers in a panel, outside the conversation.
      ctx.openDialog({ kind: 'btw', question: arg });
    },
  },
  {
    name: '/add-dir',
    description: 'Add a working directory for file access during the current session',
    usage: '<path>',
    takesArg: true,
    run: (ctx, arg) => {
      if (!arg) {
        // Claude Code asks for the path in a dialog, with Tab completion.
        ctx.openDialog({
          kind: 'input',
          title: 'Add directory to workspace',
          description: `${APP_NAME} will be able to read files in this directory and make edits when auto-accept edits is on.`,
          label: 'Enter the path to the directory:',
          placeholder: 'Directory path…',
          hint: 'Tab to complete · Enter to add · Esc to cancel',
          complete: (value) => completeDirectory(value, ctx.config.workspaceDir, fs, path),
          onSubmit: (value) => COMMANDS.find((c) => c.name === '/add-dir')?.run(ctx, value),
        });
        return;
      }
      const dir = path.resolve(ctx.config.workspaceDir, arg);
      if (!fs.existsSync(dir)) { ctx.addSystem(`Directory not found: ${dir}`); return; }
      ctx.addDir(dir);
      ctx.addSystem(`Added ${dir} to the allowed directories for this session.`);
    },
  },
  {
    name: '/skills',
    description: 'List custom commands and skills (reload to refresh)',
    usage: '[reload]',
    takesArg: true,
    run: (ctx, arg) => {
      const skills = arg.trim() === 'reload' ? ctx.reloadSkills() : ctx.skills;
      if (skills.length === 0) {
        ctx.addSystem(`No custom command or skill found.\nCreate \`.fuller/commands/<name>.md\` (or \`.fuller/skills/<name>/SKILL.md\`) in the project, or in \`~/.fuller/\`. Claude Code's \`.claude/commands\` and \`.claude/skills\` are read too.\nFrontmatter: \`description\`, \`argument-hint\`, \`allowed-tools\`, \`disable-model-invocation\`, \`user-invocable\`. Body: Markdown with \`$ARGUMENTS\`, \`$1\`…, \`!\\\`cmd\\\`\` and \`@file\`.`);
        return;
      }
      const lines = skills.map((sk) => `- \`/${sk.name}${sk.argumentHint ? ' ' + sk.argumentHint : ''}\` — ${sk.description || '(no description)'} · ${sk.kind}, ${sk.scope}${sk.userInvocable ? '' : ', model only'}${sk.modelInvocable ? '' : ', user only'}${sk.allowedTools.length ? `, allows ${sk.allowedTools.join(' ')}` : ''}`);
      ctx.addSystem(`**Custom commands & skills** (${skills.length})${arg.trim() === 'reload' ? ' — reloaded' : ''}\n${lines.join('\n')}\n\nFiles: ${[...new Set(skills.map((sk) => path.dirname(sk.file)))].join(', ')}`);
    },
  },
  {
    name: '/copy',
    description: 'Copy the last assistant response to clipboard',
    usage: '[N]',
    takesArg: true,
    run: async (ctx, arg) => {
      const n = Math.max(1, parseInt(arg, 10) || 1);
      const texts = ctx.agent.getMessages().filter((m) => m.role === 'assistant' && (m.content || m.parts?.some((p) => p.type === 'text')));
      const msg = texts[texts.length - n];
      if (!msg) { ctx.addSystem('No assistant message to copy'); return; }
      const text = msg.content || (msg.parts ?? []).filter((p) => p.type === 'text').map((p: any) => p.content).join('\n\n');
      try {
        const via = await copyToClipboard(text);
        ctx.addSystem(`Copied ${text.length} characters to the clipboard (${via}).`);
      } catch (err: any) {
        ctx.addSystem(`✗ ${err.message}`, 'notice');
      }
    },
  },
  {
    name: '/rename',
    description: 'Rename the current session',
    usage: '<title>',
    takesArg: true,
    run: (ctx, arg) => {
      if (!arg.trim()) { ctx.addSystem('Usage: `/rename <title>`'); return; }
      ctx.agent.renameSession(arg.trim());
      ctx.addSystem(`Session renamed to **${arg.trim()}**.`);
    },
  },
  {
    name: '/agents',
    description: 'Explain how to create or manage subagents',
    run: (ctx) => {
      // Claude Code 2.1.281 no longer has an /agents wizard; it points to the files.
      const names = ctx.agent.getSubagents().map((d) => d.name).join(', ');
      ctx.addSystem(`Ask ${APP_NAME} to create or update subagents for you (e.g. "create a code-reviewer subagent that ..."),\nor edit the files directly:\n  • .fuller/agents/       (this project)\n  • .claude/agents/       (read too)\n\nAvailable now: ${names || 'none'}`);
    },
  },
  {
    name: '/mcp',
    description: 'Show MCP server connections and their tools',
    run: (ctx) => {
      const statuses = ctx.agent.mcpStatuses();
      const tools = ctx.agent.mcpTools();
      ctx.openDialog({
        kind: 'list',
        title: 'Manage MCP servers',
        header: [`${statuses.length} server${statuses.length === 1 ? '' : 's'}`],
        numbered: false,
        items: statuses.map((st) => ({
          glyph: st.status === 'connected' ? '✔' : st.status === 'failed' ? '✘' : '◯',
          label: st.name,
          hint: st.status === 'connected' ? `${tools.filter((t) => t.server === st.name).length} tools` : st.error ? `${st.status}: ${st.error}` : st.status,
        })),
        empty: 'No MCP servers configured.',
        footer: 'Add servers in .mcp.json or ~/.fuller/mcp.json · tools appear as mcp__<server>__<tool>',
      });
    },
  },
  {
    name: '/tasks',
    description: 'List background work in this session',
    usage: '[kill <id>]',
    takesArg: true,
    run: (ctx, arg) => {
      const [action, id] = arg.split(/\s+/);
      if (action === 'kill' && id) {
        const t = ctx.agent.killBackgroundTask(id);
        ctx.addSystem(t ? `Task ${t.id}: ${t.status}` : `Unknown task "${id}".`);
        return;
      }
      const lines = ctx.agent.describeBackgroundTasks();
      ctx.openDialog({
        kind: 'list',
        title: 'Background',
        items: lines.map((line) => ({ label: line })),
        empty: 'No tasks currently running',
        hint: lines.length ? '↑/↓ to select · Enter to view · Esc to close' : 'Esc to close',
      });
    },
  },
  {
    name: '/hooks',
    description: 'View hook configurations for tool events',
    run: (ctx) => {
      const config = ctx.config.settings.hooks ?? {};
      const count = (event: string) => ((config as Record<string, Array<{ hooks?: unknown[] }>>)[event] ?? []).reduce((n, group) => n + (group.hooks?.length ?? 0), 0);
      const total = HOOK_DESCRIPTIONS.reduce((n, [event]) => n + count(event), 0);
      ctx.openDialog({
        kind: 'list',
        title: 'Hooks',
        header: [`${total} hook${total === 1 ? '' : 's'} configured`, `This menu is read-only. To add or change a hook, edit settings.json or ask ${APP_NAME}.`],
        items: HOOK_DESCRIPTIONS.map(([event, description]) => ({
          label: event,
          hint: `${description}${count(event) ? ` · ${count(event)} configured` : ''}`,
          onSelect: () => ctx.addSystem(describeHooks(config).filter((line) => line.includes(event)).join('\n') || `No hook for ${event}.`),
        })),
      });
    },
  },
  {
    name: '/verbose',
    description: 'Toggle the detailed transcript (ctrl+o)',
    run: (ctx) => ctx.toggleVerbose(),
  },
  {
    name: '/about',
    description: `About ${APP_NAME}`,
    run: (ctx) => {
      ctx.addSystem(
        `**${APP_NAME} v${APP_VERSION}** — terminal coding agent (Ink + Gemini).\n\nNamed after **Thomas Fuller (c. 1710–1790)**, known as *the Virginia Calculator*. Born in Africa and enslaved in Virginia from 1724, he never learned to read or write, yet solved long calculations in his head: asked how many seconds a man had lived at 70 years, 17 days and 12 hours, he answered in about a minute and a half, and pointed out that his examiner had forgotten the leap years.`
      );
    },
  },
  {
    name: '/exit',
    description: 'Exit the CLI',
    aliases: ['/quit'],
    run: (ctx) => ctx.exit(),
  },
];

export function findCommand(name: string): SlashCommand | undefined {
  return COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
}

/** Returns true when the input was a slash command (handled or unknown). */
export async function runCommand(input: string, ctx: CommandContext): Promise<boolean> {
  if (!input.startsWith('/')) return false;
  const [name, ...rest] = input.trim().split(/\s+/);
  const arg = rest.join(' ');
  const cmd = findCommand(name);
  if (!cmd) {
    const skill = ctx.skills.find((sk) => sk.userInvocable && `/${sk.name}` === name);
    if (skill) {
      try {
        const prompt = commandPrompt(skill, await expandSkill(skill, arg, ctx.config.workspaceDir));
        void ctx.agent.handleUserInput(input.trim(), 'command', { prompt, allow: skill.allowedTools });
      } catch (err: any) {
        ctx.addSystem(`✗ ${name}: ${err.message || String(err)}`, 'notice');
      }
      return true;
    }
    ctx.addSystem(`Unknown command: ${name}`, 'warning');
    return true;
  }
  try {
    await cmd.run(ctx, arg);
  } catch (err: any) {
    ctx.addSystem(`✗ ${name}: ${err.message || String(err)}`, 'notice');
  }
  return true;
}
