import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { AgentLoop } from '../agent/loop.js';
import { addPermissionRule, removePermissionRule, loadSettingsSources, type AppConfig } from '../config.js';
import { loadProjectContext, memoryFilePath } from '../agent/contextLoader.js';
import { getSystemPrompt } from '../agent/systemPrompt.js';
import { geminiToolDeclarations } from '../tools/registry.js';
import { executeBash } from '../tools/bash.js';
import { listSessions, formatRelative, sessionsDir } from '../session/store.js';
import { getThemeNames, type Theme } from './theme.js';
import { APP_NAME, APP_VERSION, PROVERBS, MEMORY_FILE } from '../branding.js';
import { formatTokens } from '../tools/truncate.js';
import { listChatModels, formatModelTable, freeTierStatus } from '../agent/models.js';
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
  toggleVerbose: () => void;
  transcriptMarkdown: () => string;
  addDir: (dir: string) => void;
  openModelPicker: () => void;
  setContextWindow: (tokens: number) => void;
  skills: SkillDefinition[];
  reloadSkills: () => SkillDefinition[];
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
    description: 'Afficher les commandes et raccourcis',
    run: (ctx) => {
      const lines = COMMANDS.map((c) => `- \`${c.name}${c.usage ? ' ' + c.usage : ''}\` — ${c.description}`).join('\n');
      ctx.addSystem(`**Commandes**\n${lines}\n\n**Raccourcis**\n- \`shift+tab\` cycle des modes (default → accept edits → plan → bypass)\n- \`esc\` interrompre · \`esc esc\` rewind (ou vider la saisie)\n- \`ctrl+o\` transcript détaillé · \`ctrl+l\` redessiner · \`ctrl+r\` recherche dans l'historique\n- \`!\` mode shell · \`@fichier\` insérer un fichier · \`\\⏎\` ou \`ctrl+j\` nouvelle ligne\n- \`?\` (saisie vide) aide clavier · \`ctrl+c\` vider / quitter (×2)`);
    },
  },
  {
    name: '/clear',
    description: "Nouvelle conversation (efface l'écran et le contexte)",
    run: (ctx) => ctx.clearConversation(),
  },
  {
    name: '/compact',
    description: 'Résumer la conversation pour libérer du contexte',
    usage: '[focus]',
    takesArg: true,
    run: (ctx, arg) => ctx.agent.compact(arg || undefined),
  },
  {
    name: '/status',
    description: 'Session, modèle, git, mode, mémoire et réglages',
    run: (ctx) => {
      const sources = loadSettingsSources(ctx.config.workspaceDir);
      const memory = loadProjectContext(ctx.config.workspaceDir);
      const allow = ctx.config.settings.permissions?.allow ?? [];
      const deny = ctx.config.settings.permissions?.deny ?? [];
      ctx.addSystem(
        `**${APP_NAME} v${APP_VERSION}**\n` +
        `- Session: \`${ctx.agent.sessionId}\` (${sessionsDir(ctx.config.workspaceDir)})\n` +
        `- Model: ${ctx.config.model} · context window ${formatTokens(ctx.config.contextWindow)}\n` +
        `- Directory: ${ctx.config.workspaceDir}${ctx.config.additionalDirectories.length ? ` (+ ${ctx.config.additionalDirectories.join(', ')})` : ''}\n` +
        `- Git: ${ctx.gitInfo?.isGit ? `${ctx.gitInfo.branch}${ctx.gitInfo.isDirty ? ' (dirty)' : ' (clean)'}` : 'not a git repository'}\n` +
        `- Permission mode: ${ctx.config.permissionMode} · allow rules: ${allow.length} · deny rules: ${deny.length}\n` +
        `- Theme: ${ctx.theme.name} · verbose: ${ctx.verbose ? 'on' : 'off'}\n` +
        `- Memory files: ${memory.length ? memory.map((m) => m.path).join(', ') : `none (create ${MEMORY_FILE} with /init)`}\n` +
        `- Settings sources: ${sources.length ? sources.map((s) => `${s.scope} (${s.file})`).join(', ') : 'none'}`
      );
    },
  },
  {
    name: '/cost',
    description: 'Tokens, appels API et durée de la session',
    aliases: ['/usage'],
    run: (ctx) => {
      const u = ctx.usage;
      ctx.addSystem(
        `**Session usage**\n- Total tokens (all API calls): ${u.cumulativeTokens.toLocaleString('en-US')}\n- Last request: ${u.promptTokens.toLocaleString('en-US')} prompt · ${u.responseTokens.toLocaleString('en-US')} response\n- API calls: ${u.apiCalls} · tool turns: ${u.turns}\n- Wall time: ${fmtDuration(Date.now() - ctx.startedAt)}\n- Pricing: see https://ai.google.dev/pricing (${ctx.config.model})`
      );
    },
  },
  {
    name: '/context',
    description: 'Répartition estimée du contexte',
    run: (ctx) => {
      const sys = getSystemPrompt({ workspaceDir: ctx.config.workspaceDir, model: ctx.config.model, permissionMode: ctx.config.permissionMode });
      const memory = loadProjectContext(ctx.config.workspaceDir);
      const memChars = memory.reduce((a, m) => a + m.content.length, 0);
      const toolChars = JSON.stringify(geminiToolDeclarations).length;
      const msgs = ctx.agent.getMessages();
      const msgChars = msgs.reduce((a, m) => a + m.content.length + (m.parts ?? []).reduce((b, p) => b + (p.type === 'tool' ? (p.toolCall.result?.length ?? 0) + JSON.stringify(p.toolCall.args).length : p.content.length), 0), 0);
      const est = (c: number) => `~${formatTokens(Math.round(c / 4))} tokens`;
      const pct = ctx.usage.promptTokens ? `${((ctx.usage.promptTokens / ctx.config.contextWindow) * 100).toFixed(1)}%` : 'n/a';
      ctx.addSystem(
        `**Context usage** (last request: ${ctx.usage.promptTokens.toLocaleString('en-US')} tokens = ${pct} of ${formatTokens(ctx.config.contextWindow)})\n- System prompt: ${est(sys.length - memChars)}\n- Memory files (${memory.length}): ${est(memChars)}\n- Tool definitions: ${est(toolChars)}\n- Messages & tool results: ${est(msgChars)} (${msgs.length} messages)\n- Auto-compact at ${Math.round(ctx.config.autoCompactThreshold * 100)}%`
      );
    },
  },
  {
    name: '/model',
    description: 'Choisir un modèle (liste depuis l\'API, historique conservé)',
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
      ctx.agent.switchModel(name);
      try {
        const known = (await listChatModels(ctx.config.apiKey, { all: true })).find((m) => m.id === name);
        if (known?.inputTokenLimit) ctx.setContextWindow(known.inputTokenLimit);
        if (!known) ctx.addSystem(`⚠ "${name}" is not in the list of chat models for this key (\`/model list all\`). Trying anyway.`, 'notice');
        else if (freeTierStatus(name) === 'paid') ctx.addSystem(`⚠ "${name}" has no free tier (billing required).`, 'notice');
      } catch {}
      ctx.addSystem(`Model switched to **${name}** (conversation history kept).`);
    },
  },
  {
    name: '/theme',
    description: 'Changer le thème',
    usage: '[name]',
    takesArg: true,
    run: (ctx, arg) => {
      const names = getThemeNames();
      if (!arg) { ctx.addSystem(`Current theme: **${ctx.theme.name}**\nAvailable: ${names.join(', ')}\nUsage: \`/theme <name>\``); return; }
      if (!names.includes(arg)) { ctx.addSystem(`Unknown theme "${arg}". Available: ${names.join(', ')}`); return; }
      ctx.setTheme(arg);
      ctx.addSystem(`Theme set to **${arg}**.`);
    },
  },
  {
    name: '/permissions',
    description: 'Lister / ajouter / retirer des règles de permission',
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
          ctx.config.settings.permissions = { ...p, allow: (p.allow ?? []).filter((r) => r !== rule), deny: (p.deny ?? []).filter((r) => r !== rule) };
        }
        ctx.addSystem(ok ? `Rule removed: \`${rule}\`` : `Rule not found: \`${rule}\``);
        return;
      }
      const allow = ctx.config.settings.permissions?.allow ?? [];
      const deny = ctx.config.settings.permissions?.deny ?? [];
      ctx.addSystem(
        `**Permission mode:** ${ctx.config.permissionMode}\n**Allow** (${allow.length})\n${allow.map((r) => `- \`${r}\``).join('\n') || '- (none)'}\n**Deny** (${deny.length})\n${deny.map((r) => `- \`${r}\``).join('\n') || '- (none)'}\n\nRules use the \`Tool(spec)\` syntax: \`Bash(npm test:*)\`, \`Edit(src/**)\`, \`WebFetch(domain:example.com)\`.\nUsage: \`/permissions add <rule>\`, \`/permissions deny <rule>\`, \`/permissions remove <rule>\``
      );
    },
  },
  {
    name: '/plan',
    description: 'Activer / désactiver le plan mode (lecture seule)',
    run: (ctx) => ctx.setMode(ctx.config.permissionMode === 'plan' ? 'default' : 'plan'),
  },
  {
    name: '/accept-edits',
    description: 'Activer / désactiver accept edits (shift+tab)',
    run: (ctx) => ctx.setMode(ctx.config.permissionMode === 'acceptEdits' ? 'default' : 'acceptEdits'),
  },
  {
    name: '/mode',
    description: 'Changer le mode de permission',
    usage: `<${PERMISSION_MODES.join('|')}>`,
    takesArg: true,
    run: (ctx, arg) => {
      if (!PERMISSION_MODES.includes(arg as PermissionMode)) { ctx.addSystem(`Usage: \`/mode <${PERMISSION_MODES.join('|')}>\` (current: ${ctx.config.permissionMode})`); return; }
      ctx.setMode(arg as PermissionMode);
    },
  },
  {
    name: '/init',
    description: `Générer un fichier ${MEMORY_FILE} pour le projet`,
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
    description: 'Lister les fichiers mémoire chargés',
    run: (ctx) => {
      const memory = loadProjectContext(ctx.config.workspaceDir);
      ctx.addSystem(
        memory.length
          ? `**Memory files**\n${memory.map((m) => `- ${m.path} (${m.scope}, ${m.content.length} chars)`).join('\n')}\n\nEdit them with your editor; changes apply on the next message.`
          : `No memory file loaded. Create \`${MEMORY_FILE}\` (or \`AGENTS.md\`) at the project root, or run \`/init\`. A user-level file is read from \`~/.fuller/${MEMORY_FILE}\`.`
      );
    },
  },
  {
    name: '/rewind',
    description: 'Restaurer les fichiers à un checkpoint (esc esc)',
    run: (ctx) => ctx.openRewind(),
  },
  {
    name: '/checkpoints',
    description: 'Lister les checkpoints de fichiers',
    run: (ctx) => {
      const cps = ctx.agent.getCheckpoints();
      ctx.addSystem(cps.length ? `**Checkpoints**\n${cps.slice(0, 20).map((c) => `- ${new Date(c.timestamp).toLocaleTimeString()} — ${c.description} (${c.files.length} file${c.files.length === 1 ? '' : 's'})`).join('\n')}` : 'No checkpoints yet.');
    },
  },
  {
    name: '/sessions',
    description: 'Lister les sessions du projet',
    aliases: ['/resume'],
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
    name: '/diff',
    description: 'Afficher les changements git non commités',
    run: async (ctx) => {
      const stat = await executeBash('git status --short && echo "---" && git diff --stat', ctx.config.workspaceDir, { timeoutMs: 10_000 });
      if (stat.exitCode !== 0) { ctx.addSystem(`git: ${stat.stderr || 'not a git repository'}`); return; }
      const diff = await executeBash('git diff', ctx.config.workspaceDir, { timeoutMs: 10_000 });
      const body = diff.stdout.split('\n').slice(0, ctx.verbose ? 800 : 120).join('\n');
      ctx.addSystem(`\`\`\`\n${stat.stdout || '(clean)'}\n\`\`\`${body ? `\n\`\`\`diff\n${body}\n\`\`\`${diff.stdout.split('\n').length > 120 && !ctx.verbose ? '\n… (ctrl+o then /diff for the full diff)' : ''}` : ''}`);
    },
  },
  {
    name: '/export',
    description: 'Exporter la conversation en Markdown',
    usage: '[file]',
    takesArg: true,
    run: (ctx, arg) => {
      const file = path.resolve(ctx.config.workspaceDir, arg || `fuller-${ctx.agent.sessionId}.md`);
      try {
        fs.writeFileSync(file, ctx.transcriptMarkdown(), 'utf8');
        ctx.addSystem(`Conversation exported → ${file}`);
      } catch (err: any) {
        ctx.addSystem(`✗ Export failed: ${err.message}`, 'notice');
      }
    },
  },
  {
    name: '/doctor',
    description: "Diagnostic de l'installation",
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
    description: "Question rapide hors contexte (n'affecte pas l'historique)",
    usage: '<question>',
    takesArg: true,
    run: (ctx, arg) => {
      if (!arg) { ctx.addSystem('Usage: `/btw <question>`'); return; }
      void ctx.agent.sideChat(arg);
    },
  },
  {
    name: '/add-dir',
    description: 'Autoriser un dossier supplémentaire',
    usage: '<path>',
    takesArg: true,
    run: (ctx, arg) => {
      if (!arg) { ctx.addSystem('Usage: `/add-dir <path>`'); return; }
      const dir = path.resolve(ctx.config.workspaceDir, arg);
      if (!fs.existsSync(dir)) { ctx.addSystem(`Directory not found: ${dir}`); return; }
      ctx.addDir(dir);
      ctx.addSystem(`Added ${dir} to the allowed directories for this session.`);
    },
  },
  {
    name: '/skills',
    description: 'Lister les commandes personnalisées et skills (reload pour rafraîchir)',
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
    description: 'Copier la dernière réponse (ou la N-ième depuis la fin) dans le presse-papiers',
    usage: '[N]',
    takesArg: true,
    run: async (ctx, arg) => {
      const n = Math.max(1, parseInt(arg, 10) || 1);
      const texts = ctx.agent.getMessages().filter((m) => m.role === 'assistant' && (m.content || m.parts?.some((p) => p.type === 'text')));
      const msg = texts[texts.length - n];
      if (!msg) { ctx.addSystem('Nothing to copy yet.'); return; }
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
    description: 'Renommer la session (titre dans /sessions et le sélecteur --resume)',
    usage: '<title>',
    takesArg: true,
    run: (ctx, arg) => {
      if (!arg.trim()) { ctx.addSystem('Usage: `/rename <title>`'); return; }
      ctx.agent.renameSession(arg.trim());
      ctx.addSystem(`Session renamed to **${arg.trim()}**.`);
    },
  },
  {
    name: '/mcp',
    description: 'Serveurs MCP : statut et outils exposés',
    run: (ctx) => {
      const statuses = ctx.agent.mcpStatuses();
      if (statuses.length === 0) {
        ctx.addSystem('No MCP server configured. Add `.mcp.json` in the project (or `~/.fuller/mcp.json`):\n```json\n{ "mcpServers": { "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" } }, "docs": { "url": "https://example.com/mcp" } } }\n```\nTools appear as `mcp__<server>__<tool>`; allow them with rules like `mcp__github` (whole server) or `mcp__github__search_issues`.');
        return;
      }
      const tools = ctx.agent.mcpTools();
      const lines = statuses.map((s) => {
        const glyph = s.status === 'connected' ? '✔' : s.status === 'failed' ? '✘' : '…';
        const own = tools.filter((t) => t.server === s.name).map((t) => `\`${t.name}\``).join(', ');
        return `- ${glyph} **${s.name}** (${s.scope}, ${s.transport}) — ${s.status}${s.error ? `: ${s.error}` : ''}${own ? `\n  ${own}` : ''}`;
      });
      ctx.addSystem(`**MCP servers**\n${lines.join('\n')}`);
    },
  },
  {
    name: '/tasks',
    description: "Tâches en arrière-plan (kill <id> pour arrêter)",
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
      ctx.addSystem(lines.length ? `**Background tasks**\n${lines.map((l) => `- ${l}`).join('\n')}\n\nLogs in ~/.fuller/tasks/<session>/ · \`/tasks kill <id>\` to stop one.` : 'No background task. The model starts one with execute_bash(run_in_background=true).');
    },
  },
  {
    name: '/hooks',
    description: 'Lister les hooks configurés (settings.json)',
    run: (ctx) => {
      const lines = describeHooks(ctx.config.settings.hooks);
      ctx.addSystem(
        lines.length
          ? `**Hooks** (${lines.length})\n${lines.map((l) => `- ${l}`).join('\n')}\n\nEvents: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Notification, Stop, PreCompact, SessionEnd. Exit 2 = block (stderr = reason); JSON stdout: decision, hookSpecificOutput.permissionDecision, updatedInput, additionalContext.`
          : 'No hook configured. Add to `.fuller/settings.json`:\n```json\n{ "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "~/.fuller/check-bash.sh", "timeout": 30 }] }] } }\n```\nThe command receives the same JSON as Claude Code hooks on stdin; exit 2 blocks with stderr as the reason.'
      );
    },
  },
  {
    name: '/verbose',
    description: 'Basculer le transcript détaillé (ctrl+o)',
    run: (ctx) => ctx.toggleVerbose(),
  },
  {
    name: '/about',
    description: `À propos de ${APP_NAME}`,
    run: (ctx) => {
      ctx.addSystem(
        `**${APP_NAME} v${APP_VERSION}** — agent de programmation en terminal (Ink + Gemini).\n\nNommé en hommage à **Thomas Fuller (1654–1734)**, médecin anglais et compilateur de la *Gnomologia* (1732), recueil de plus de 6 000 proverbes — source de la plupart des aphorismes attribués à « Thomas Fuller ». À ne pas confondre avec Thomas Fuller (1608–1661), pasteur et historien, auteur de *The Worthies of England*.\n\n${PROVERBS.slice(0, 5).map((p) => `> “${p.text}” — ${p.source}`).join('\n')}`
      );
    },
  },
  {
    name: '/exit',
    description: `Quitter ${APP_NAME}`,
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
    ctx.addSystem(`Unknown command: \`${name}\`. Type \`/help\` for the list.`, 'notice');
    return true;
  }
  try {
    await cmd.run(ctx, arg);
  } catch (err: any) {
    ctx.addSystem(`✗ ${name}: ${err.message || String(err)}`, 'notice');
  }
  return true;
}
