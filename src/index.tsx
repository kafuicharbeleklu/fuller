#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './ui/App.js';
import { getConfig, DEFAULT_MODEL } from './config.js';
import { getLatestSession, loadSession } from './session/store.js';
import { runHeadless, type OutputFormat } from './headless.js';
import { APP_NAME, APP_SLUG, APP_VERSION } from './branding.js';
import { PERMISSION_MODES, type PermissionMode } from './agent/types.js';
import { listChatModels, formatModelTable, knownContextWindow } from './agent/models.js';
import { installFrameWriter } from './ui/frameWriter.js';
import { runScreenReader } from './ui/screenReader.js';

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
  .option('--list-models', 'List recent, free-of-charge chat models available to your API key and exit', false)
  .option('--all', 'With --list-models: include every chat model (paid and older ones)', false)
  .option('--theme <name>', 'Theme (auto, dark, light, *-daltonized, *-ansi, monokai, ocean, forest, lagoon, olive, amethyst, citrus)')
  .option('--screen-reader', 'Use a plain, linear interactive interface for screen readers')
  .option('--tui <mode>', 'Terminal renderer: fullscreen (default) | classic; FULLER_DISABLE_ALTERNATE_SCREEN=1 forces classic')
  .action(async (promptArgs: string[], options) => {
    let permissionMode: PermissionMode | undefined = options.permissionMode;
    if (permissionMode && !PERMISSION_MODES.includes(permissionMode)) {
      process.stderr.write(`Invalid --permission-mode "${permissionMode}". Expected one of: ${PERMISSION_MODES.join(', ')}\n`);
      process.exit(2);
    }
    if (options.dangerouslySkipPermissions || options.yes) permissionMode = 'bypassPermissions';

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
    if (options.allowedTools?.length) {
      config.settings.permissions = {
        ...config.settings.permissions,
        allow: [...(config.settings.permissions?.allow ?? []), ...options.allowedTools],
      };
    }

    let initialPrompt = promptArgs.length > 0 ? promptArgs.join(' ') : undefined;

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

    // Like Claude Code, start fullscreen unless the classic renderer is asked for.
    options.tui ??= process.env.FULLER_DISABLE_ALTERNATE_SCREEN === '1' ? 'classic' : 'fullscreen';
    if (!['classic', 'fullscreen'].includes(options.tui)) {
      process.stderr.write('Invalid --tui mode. Expected classic or fullscreen.\n');
      process.exit(2);
    }

    // ---------------------------------------------------------------- terminal setup
    const stdout = process.stdout;
    const originalWrite = stdout.write.bind(stdout);
    const fullscreen = options.tui === 'fullscreen';
    if (fullscreen) {
      originalWrite('\x1b[?1049h\x1b[H');
    } else {
      originalWrite('\x1b[2J\x1b[3J\x1b[H');
    }
    // Frame writer: exact erase counts after a resize + synchronized output (DEC 2026).
    const reflow = process.env.FULLER_NO_REFLOW === '1' ? false : (process.env.FULLER_REFLOW ? process.env.FULLER_REFLOW === '1' : true);
    const frameWriter = installFrameWriter(stdout, { reflow });
    // Bracketed paste so multi-line pastes arrive as one event.
    originalWrite('\x1b[?2004h');
    const mouse = fullscreen && process.env.FULLER_DISABLE_MOUSE !== '1';
    if (mouse) originalWrite('\x1b[?1000h\x1b[?1006h');

    // Lay out one column narrower than the terminal so that no line ever ends in the
    // last column (the "pending wrap" state confuses some terminals' reflow).
    const LAYOUT_MARGIN = 1;
    const inkStdout = new Proxy(stdout, {
      get(target, prop, receiver) {
        if (prop === 'columns') return Math.max(20, (target.columns || 80) - LAYOUT_MARGIN);
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as NodeJS.WriteStream;

    let summary = '';
    const app = render(
      <App config={config} initialPrompt={initialPrompt} restoredSession={restoredSession} pickSession={pickSession} onExitSummary={(s) => { summary = s; }} frameWriter={frameWriter} fullscreen={fullscreen} />,
      { stdout: inkStdout, exitOnCtrlC: false, patchConsole: true }
    );

    // Remove Ink's eager resize listener, then relay native resize events to App's
    // debounced listener through a separate event. Removing every native listener
    // previously also removed App's listener when its effect had already mounted.
    for (const listener of stdout.listeners('resize')) stdout.off('resize', listener as (...args: any[]) => void);
    const relayResize = () => stdout.emit('fuller:resize');
    stdout.on('resize', relayResize);

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

    await app.waitUntilExit();
    cleanup();
    if (summary) originalWrite(`\n${summary}\n`);
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
