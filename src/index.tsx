#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './ui/App.js';
import path from 'node:path';
import { getConfig, loadEnvFiles, DEFAULT_MODEL } from './config.js';
import { isTrusted, trustFolder } from './trust.js';
import { loadMcpConfig } from './mcp/config.js';
import { mcpApproval, pendingServers, saveMcpApproval, type McpApproval } from './mcp/approval.js';
import { McpApprovalDialog } from './ui/McpApprovalDialog.js';
import { TrustDialog } from './ui/TrustDialog.js';
import { ThemeProvider, loadTheme } from './ui/theme.js';
import { getLatestSession, loadSession } from './session/store.js';
import { runHeadless, type OutputFormat } from './headless.js';
import { APP_NAME, APP_SLUG, APP_VERSION } from './branding.js';
import { PERMISSION_MODES, type PermissionMode } from './agent/types.js';
import { checkKeys } from './agent/keyCheck.js';
import { listChatModels, formatModelTable, knownContextWindow } from './agent/models.js';
import { installFrameWriter } from './ui/frameWriter.js';
import { runScreenReader } from './ui/screenReader.js';

/** The trust question, alone on screen before Fuller starts; resolves with the answer. */
function askTrust(folder: string): Promise<boolean> {
  return new Promise((resolve) => {
    const app = render(
      <ThemeProvider theme={loadTheme()}>
        <TrustDialog folder={folder} onDecide={(trusted) => { app.clear(); app.unmount(); resolve(trusted); }} />
      </ThemeProvider>,
      { exitOnCtrlC: false, patchConsole: false },
    );
  });
}

/** The question about a project's new MCP servers, alone on screen; resolves with the answer. */
function askMcpApproval(names: string[]): Promise<McpApproval> {
  return new Promise((resolve) => {
    const app = render(
      <ThemeProvider theme={loadTheme()}>
        <McpApprovalDialog names={names} onDone={(answer) => { app.clear(); app.unmount(); resolve(answer); }} />
      </ThemeProvider>,
      { exitOnCtrlC: false, patchConsole: false },
    );
  });
}

const program = new Command();

program
  .name(APP_SLUG)
  .description(`${APP_NAME} — agentic coding assistant in your terminal (Ink + Gemini)`)
  .version(APP_VERSION)
  .argument('[prompt...]', 'Initial prompt')
  .option('-m, --model <model>', `Gemini model (default: $GEMINI_MODEL or ${DEFAULT_MODEL})`)
  .option('-k, --key <key>', 'Gemini API key (default: $GEMINI_API_KEY)')
  .option('-d, --dir <dir>', 'Working directory', process.cwd())
  .option('--add-dir <dirs...>', 'Additional directories the agent may access')
  .option('-p, --print', 'Non-interactive mode: run the prompt, print the answer and exit', false)
  .option('--output-format <format>', 'Output format for -p: text | json | stream-json', 'text')
  .option('--permission-mode <mode>', `Permission mode: ${PERMISSION_MODES.join(' | ')}`)
  .option('--dangerously-skip-permissions', 'Bypass all permission prompts (same as --permission-mode bypassPermissions)', false)
  .option('-y, --yes', 'Alias of --dangerously-skip-permissions', false)
  .option('--allowedTools <rules...>', 'Extra allow rules for this run, e.g. "Bash(npm test:*)" "Edit(src/**)"')
  .option('--max-turns <n>', 'Maximum tool turns per prompt', (v) => parseInt(v, 10))
  .option('-c, --continue', 'Resume the latest session of this workspace', false)
  .option('-r, --resume [id]', 'Resume a session (interactive picker when no id is given)')
  .option('--fallback-model <models>', 'Models tried in turn when the current one is out of quota on every key or overloaded (comma list; "off" to disable; default: the free Gemini models, then Gemma 4)')
  .option('--check-keys', 'Test every configured Gemini API key with a tiny request and exit (keys are never shown)', false)
  .option('--list-models', 'List recent, free-of-charge chat models available to your API key and exit', false)
  .option('--all', 'With --list-models: include every chat model (paid and older ones)', false)
  .option('--theme <name>', 'Theme (auto, dark, light, *-daltonized, *-ansi, monokai, ocean, forest, lagoon, olive, amethyst, citrus)')
  .option('--screen-reader', 'Use a plain, linear interactive interface for screen readers')
  .option('--tui <mode>', 'Terminal renderer: fullscreen (default) | classic (alias default); /tui switches in a session and keeps the choice; FULLER_DISABLE_ALTERNATE_SCREEN=1 forces classic')
  .action(async (promptArgs: string[], options) => {
    let permissionMode: PermissionMode | undefined = options.permissionMode;
    if (permissionMode && !PERMISSION_MODES.includes(permissionMode)) {
      process.stderr.write(`Invalid --permission-mode "${permissionMode}". Expected one of: ${PERMISSION_MODES.join(', ')}\n`);
      process.exit(2);
    }
    if (options.dangerouslySkipPermissions || options.yes) permissionMode = 'bypassPermissions';

    // Claude Code's trust question comes before anything of the folder is read: its .env, settings
    // (hooks, env, permission rules), MCP servers. -p and the key/model checks are run on purpose in
    // the folder: like Claude Code's -p, they count as trusted.
    const workspaceDir = path.resolve(options.dir ?? process.cwd());
    const interactive = !options.print && !options.checkKeys && !options.listModels;
    let trusted = isTrusted(workspaceDir);
    if (!trusted && interactive) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        process.stderr.write(`${APP_NAME} needs a terminal to ask whether you trust ${workspaceDir}. Run it in a terminal, or use -p.\n`);
        process.exit(1);
      }
      trusted = await askTrust(workspaceDir);
      if (!trusted) process.exit(0);
      trustFolder(workspaceDir);
    }
    loadEnvFiles(workspaceDir, trusted || !interactive);

    // Then, as Claude Code, one question about the project's new MCP servers, before any starts.
    const pendingMcp = pendingServers(loadMcpConfig(workspaceDir), mcpApproval(workspaceDir)).map((e) => e.name);
    if (pendingMcp.length && interactive && process.stdin.isTTY && process.stdout.isTTY) {
      saveMcpApproval(workspaceDir, await askMcpApproval(pendingMcp));
    } else if (pendingMcp.length && options.print) {
      process.stderr.write(`Not starting project MCP server${pendingMcp.length === 1 ? '' : 's'} ${pendingMcp.join(', ')}: start ${APP_NAME} in this folder once to approve ${pendingMcp.length === 1 ? 'it' : 'them'}.\n`);
    }

    const config = getConfig({
      apiKey: options.key,
      model: options.model,
      workspaceDir: options.dir,
      permissionMode,
      additionalDirectories: options.addDir,
      headless: !!options.print,
      maxTurns: options.maxTurns,
    });
    if (options.theme) config.settings.theme = options.theme;
    if (options.fallbackModel) {
      // --fallback-model off | model | model1,model2 (tried in this order).
      const value = String(options.fallbackModel).trim();
      config.settings.fallbackModels = value === 'off' ? 'off' : value.split(',').map((m) => m.trim()).filter(Boolean);
      // As Claude Code's --fallback-model: an explicit fallback switches without asking.
      if (value !== 'off') config.settings.modelFallback = 'auto';
    }
    if (options.allowedTools?.length) {
      config.settings.permissions = {
        ...config.settings.permissions,
        allow: [...(config.settings.permissions?.allow ?? []), ...options.allowedTools],
      };
    }

    let initialPrompt = promptArgs.length > 0 ? promptArgs.join(' ') : undefined;

    if (options.checkKeys) {
      const keys = config.apiKeys?.length ? config.apiKeys : config.apiKey ? [config.apiKey] : [];
      if (!keys.length) { process.stderr.write('Error: no GEMINI_API_KEY configured.\n'); process.exit(1); }
      process.stdout.write(`Checking ${keys.length} key${keys.length === 1 ? '' : 's'} with ${config.model} (one tiny request each)…\n`);
      const results = await checkKeys(keys, config.model, {
        onResult: (r) => process.stdout.write(`  key ${String(r.position).padStart(2)}/${keys.length} (${r.kind}…) ${r.health.padEnd(10)} ${r.seconds.toFixed(1).padStart(5)} s${r.detail ? `  ${r.detail}` : ''}\n`),
      });
      const count = (h: string) => results.filter((r) => r.health === h).length;
      process.stdout.write(`\n${count('ok') + count('slow')} working (${count('slow')} slow) · ${count('quota')} out of quota · ${count('denied')} denied · ${count('invalid')} invalid · ${count('overloaded')} overloaded · ${count('no answer') + count('error')} other\n`);
      process.exit(0);
    }
    if (options.listModels) {
      if (!config.apiKey) { process.stderr.write('Error: GEMINI_API_KEY is required.\n'); process.exit(1); }
      const models = await listChatModels(config.apiKey, { force: true, all: !!options.all });
      process.stdout.write(`${formatModelTable(models)}\n\n${models.length} ${options.all ? 'chat models' : 'recent free-tier models (use --all for every model)'} · current default: ${config.model}\n`);
      process.exit(0);
    }
    const ctxWindow = knownContextWindow(config.model);
    if (ctxWindow && !process.env.FULLER_CONTEXT_WINDOW && !config.settings.contextWindow) config.contextWindow = ctxWindow;

    // ---------------------------------------------------------------- headless
    if (options.print || !process.stdin.isTTY || !process.stdout.isTTY) {
      if (!initialPrompt && !process.stdin.isTTY) {
        initialPrompt = (await readStdin()).trim() || undefined;
      }
      if (!options.print && !initialPrompt) {
        process.stderr.write(`${APP_NAME} needs an interactive terminal. Use -p "prompt" for non-interactive mode.\n`);
        process.exit(2);
      }
      if (!initialPrompt) {
        process.stderr.write('No prompt given. Usage: fuller -p "your prompt" (or pipe the prompt on stdin).\n');
        process.exit(2);
      }
      if (!config.apiKey) {
        process.stderr.write('Error: GEMINI_API_KEY is required (env, .env, or --key).\n');
        process.exit(1);
      }
      const format = String(options.outputFormat) as OutputFormat;
      if (!['text', 'json', 'stream-json'].includes(format)) {
        process.stderr.write(`Invalid --output-format "${format}". Expected text | json | stream-json.\n`);
        process.exit(2);
      }
      const onSignal = () => process.exit(143);
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
      const code = await runHeadless(config, initialPrompt, format);
      process.exit(code);
    }

    // ---------------------------------------------------------------- session restore
    let restoredSession;
    let pickSession = false;
    if (options.continue) {
      restoredSession = getLatestSession(config.workspaceDir) ?? undefined;
      if (!restoredSession) process.stderr.write('No previous session for this workspace — starting a new one.\n');
    } else if (options.resume !== undefined) {
      if (typeof options.resume === 'string') {
        restoredSession = loadSession(config.workspaceDir, options.resume) ?? undefined;
        if (!restoredSession) process.stderr.write(`Session "${options.resume}" not found — starting a new one.\n`);
      } else {
        pickSession = true;
      }
    }

    if (options.screenReader || process.env.FULLER_SCREEN_READER === '1') {
      if (!config.apiKey) { process.stderr.write('Error: GEMINI_API_KEY is required.\n'); process.exit(1); }
      await runScreenReader(config, initialPrompt, restoredSession, pickSession);
      return;
    }

    // Like Claude Code, start fullscreen unless the classic renderer is asked for (flag, environment,
    // or the `tui` setting that /tui saves).
    options.tui ??= process.env.FULLER_DISABLE_ALTERNATE_SCREEN === '1' ? 'classic' : config.settings.tui === 'default' ? 'classic' : 'fullscreen';
    if (options.tui === 'default') options.tui = 'classic';
    if (!['classic', 'fullscreen'].includes(options.tui)) {
      process.stderr.write('Invalid --tui mode. Expected classic (or default) or fullscreen.\n');
      process.exit(2);
    }

    // ---------------------------------------------------------------- terminal setup
    const stdout = process.stdout;
    const originalWrite = stdout.write.bind(stdout);
    let fullscreen = options.tui === 'fullscreen';
    const mouseAllowed = process.env.FULLER_DISABLE_MOUSE !== '1';
    /** Screen and mouse modes of one renderer; /tui leaves one and enters the other. */
    const enterRenderer = (full: boolean) => {
      originalWrite(full ? '\x1b[?1049h\x1b[H' : '\x1b[2J\x1b[3J\x1b[H');
      if (full && mouseAllowed) originalWrite('\x1b[?1000h\x1b[?1006h');
    };
    const leaveRenderer = (full: boolean) => {
      originalWrite(`\x1b[?1000l\x1b[?1006l${full ? '\x1b[?1049l' : ''}`);
    };
    enterRenderer(fullscreen);
    // Frame writer: exact erase counts after a resize + synchronized output (DEC 2026).
    const reflow = process.env.FULLER_NO_REFLOW === '1' ? false : (process.env.FULLER_REFLOW ? process.env.FULLER_REFLOW === '1' : true);
    const frameWriter = installFrameWriter(stdout, { reflow });
    frameWriter.setFullscreen(fullscreen);
    // Bracketed paste so multi-line pastes arrive as one event.
    originalWrite('\x1b[?2004h');

    // The classic renderer lays out one column narrower than the terminal so that no line ever ends
    // in the last column (the "pending wrap" state confuses some terminals' reflow). Fullscreen
    // repaints every row in place, without reflow: it uses the full width, as Claude Code does.
    const LAYOUT_MARGIN = 1;
    const inkStdout = new Proxy(stdout, {
      get(target, prop, receiver) {
        if (prop === 'columns') return Math.max(20, (target.columns || 80) - (fullscreen ? 0 : LAYOUT_MARGIN));
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as NodeJS.WriteStream;

    // Ink's eager resize listener is removed after each mount; native resize events reach App's
    // debounced listener through a separate event.
    const relayResize = () => stdout.emit('fuller:resize');
    const takeOverResize = () => {
      for (const listener of stdout.listeners('resize')) if (listener !== relayResize) stdout.off('resize', listener as (...args: any[]) => void);
      if (!stdout.listeners('resize').includes(relayResize)) stdout.on('resize', relayResize);
    };

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      stdout.off('resize', relayResize);
      frameWriter.restore();
      originalWrite(`\x1b[?2004l\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b]0;\x07${fullscreen ? '\x1b[?1049l' : ''}`);
    };
    process.on('exit', cleanup);
    process.on('SIGTERM', () => { cleanup(); process.exit(143); });
    process.on('SIGHUP', () => { cleanup(); process.exit(129); });

    // One mount per renderer: /tui unmounts the interface, switches the terminal, and mounts it
    // again on the saved session, as Claude Code's /tui keeps the conversation.
    let summary = '';
    let session = restoredSession;
    let picker = pickSession;
    let prompt = initialPrompt;
    for (;;) {
      let next: { mode: 'classic' | 'fullscreen'; session: typeof restoredSession } | null = null;
      const app = render(
        <App config={config} initialPrompt={prompt} restoredSession={session} pickSession={picker} onExitSummary={(s) => { summary = s; }} frameWriter={frameWriter} fullscreen={fullscreen}
          onSwitchRenderer={(mode, data) => { next = { mode, session: data }; }} />,
        { stdout: inkStdout, exitOnCtrlC: false, patchConsole: true }
      );
      takeOverResize();
      await app.waitUntilExit();
      const switched = next as { mode: 'classic' | 'fullscreen'; session: typeof restoredSession } | null;
      if (!switched) break;
      app.cleanup?.();
      leaveRenderer(fullscreen);
      fullscreen = switched.mode === 'fullscreen';
      enterRenderer(fullscreen);
      frameWriter.setFullscreen(fullscreen);
      session = switched.session;
      picker = false;
      prompt = undefined;
    }
    cleanup();
    // The session is saved (handleExit waited for it): leave now, as Claude Code does, rather than
    // wait for whatever is still pending (a keep-alive socket, a timer, a slow child) to let go.
    originalWrite(summary ? `\n${summary}\n` : '', () => process.exit(0));
  });

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`${err?.message ?? err}\n`);
  process.exit(1);
});
