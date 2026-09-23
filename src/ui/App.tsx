import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useStdout } from 'ink';
import { ThemeProvider, loadTheme, resolveTheme, saveTheme, type Theme } from './theme.js';
import type { FrameWriter } from './frameWriter.js';
import { TranscriptItemView } from './Transcript.js';
import { LiveArea } from './LiveArea.js';
import { SpinnerLine, useSpinnerFrame } from './Spinner.js';
import { PermissionPrompt } from './PermissionPrompt.js';
import { RewindMenu } from './RewindMenu.js';
import { ModelPicker } from './ModelPicker.js';
import { knownContextWindow } from '../agent/models.js';
import { SessionPicker } from './SessionPicker.js';
import { InputBox } from './InputBox.js';
import { Footer } from './Footer.js';
import { TodoPanel } from './TodoPanel.js';
import { useStatusLine } from './useStatusLine.js';
import { COMMANDS, runCommand, type CommandContext, type SlashCommand } from './commands.js';
import type { SkillDefinition } from '../skills/loader.js';
import { AgentLoop, type AgentCallbacks } from '../agent/loop.js';
import { messagesToTranscript } from '../agent/transcript.js';
import { getGitInfo, type GitInfo } from '../utils/git.js';
import { listSessions, loadSession, type SessionData } from '../session/store.js';
import { loadPromptHistory, appendPromptHistory } from '../session/history.js';
import { APP_NAME, STARTUP_TIPS } from '../branding.js';
import type { AppConfig } from '../config.js';
import type { BannerProps } from './Banner.js';
import type {
  AgentStatus, LiveTurn, Notice, PendingConfirmation, PermissionMode, TranscriptItem, UsageInfo, TodoItem,
} from '../agent/types.js';
import { PERMISSION_MODES } from '../agent/types.js';

export interface AppProps {
  config: AppConfig;
  initialPrompt?: string;
  restoredSession?: SessionData;
  pickSession?: boolean;
  onExitSummary?: (summary: string) => void;
  frameWriter?: FrameWriter;
}

export const App: React.FC<AppProps> = ({ config, initialPrompt, restoredSession, pickSession, onExitSummary, frameWriter }) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [theme, setThemeState] = useState<Theme>(() => loadTheme(config.settings.theme));
  const [screen, setScreen] = useState<'picker' | 'main'>(pickSession ? 'picker' : 'main');
  const [restored, setRestored] = useState<SessionData | undefined>(restoredSession);
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [generation, setGeneration] = useState(0);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [mode, setMode] = useState<PermissionMode>(config.permissionMode);
  const [usage, setUsage] = useState<UsageInfo>({ promptTokens: 0, responseTokens: 0, cumulativeTokens: 0, contextWindow: config.contextWindow, apiCalls: 0, turns: 0 });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [verbose, setVerbose] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [rewindOpen, setRewindOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [model, setModel] = useState(config.model);
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [showTodos, setShowTodos] = useState(true);
  const [sessionId, setSessionId] = useState('');
  const [backgroundRunning, setBackgroundRunning] = useState(0);
  const [gitInfo, setGitInfo] = useState<GitInfo | undefined>();
  const [inputState, setInputState] = useState({ empty: true, bashMode: false });
  const [turnStartedAt, setTurnStartedAt] = useState(Date.now());
  const agentRef = useRef<AgentLoop | null>(null);
  const statusRef = useRef<AgentStatus>('idle');
  const startedAt = useRef(Date.now());
  const history = useMemo(() => loadPromptHistory(config.workspaceDir), [config.workspaceDir]);
  const frame = useSpinnerFrame(status !== 'idle' && status !== 'awaiting_permission');
  const rows = stdout?.rows ?? 24;

  const bannerProps: BannerProps = useMemo(() => ({
    model: config.model,
    workspaceDir: config.workspaceDir,
    gitBranch: gitInfo?.isGit ? gitInfo.branch : undefined,
    gitDirty: gitInfo?.isDirty,
    tip: STARTUP_TIPS[Math.floor(Math.random() * STARTUP_TIPS.length)],
    resumed: restored?.meta.id,
  }), [config.model, config.workspaceDir, gitInfo, restored]);

  const bell = useCallback((event: 'permission' | 'done' | 'error') => {
    if (config.notifications === 'off') return;
    if (config.notifications === 'permission' && event === 'done') return;
    if (stdout?.isTTY) stdout.write('\x07');
  }, [config.notifications, stdout]);

  // ------------------------------------------------------------ agent bootstrap
  useEffect(() => {
    if (screen !== 'main' || !config.apiKey) return;
    const callbacks: AgentCallbacks = {
      onStatusChange: (s) => {
        if (s !== 'idle' && statusRef.current === 'idle') setTurnStartedAt(Date.now());
        statusRef.current = s;
        setStatus(s);
      },
      onCommit: (item) => setItems((prev) => [...prev, item]),
      onLive: setLive,
      onRequestConfirmation: setConfirmation,
      onUsage: setUsage,
      onNotice: setNotice,
      onQueueChange: setQueue,
      onModeChange: setMode,
      onNotify: bell,
      onTodosChange: (t) => { setTodos(t); if (t.some((x) => x.status !== 'completed')) setShowTodos(true); },
      onBackgroundChange: (running) => setBackgroundRunning(running),
    };
    const agent = restored ? AgentLoop.fromSession(restored, config, callbacks) : new AgentLoop(config, callbacks);
    agentRef.current = agent;
    setSkills(agent.getSkills());
    setTodos(agent.getTodos());
    setSessionId(agent.sessionId);
    const ctxWindow = knownContextWindow(config.model);
    if (ctxWindow) agent.setContextWindow(ctxWindow);
    setItems([{ key: 'banner', kind: 'banner' }, ...(restored ? messagesToTranscript(restored.messages) : [])]);
    if (restored) setUsage((u) => ({ ...u, cumulativeTokens: restored.meta.tokenCount }));
    getGitInfo(config.workspaceDir).then((info) => {
      setGitInfo(info);
      agent.setGitBranch(info.isGit ? info.branch : undefined);
    });
    if (initialPrompt) void agent.handleUserInput(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // Terminal title
  useEffect(() => {
    if (!stdout?.isTTY) return;
    const base = `${APP_NAME} · ${config.workspaceDir.split('/').pop()}`;
    const title = status === 'idle' ? base : status === 'awaiting_permission' ? `⚠ ${base}` : `✻ ${base}`;
    stdout.write(`\x1b]0;${title}\x07`);
  }, [status, stdout, config.workspaceDir]);

  // ------------------------------------------------------------ helpers
  /**
   * Clear the visible screen and re-render the whole transcript (static items are
   * remounted so they are laid out again at the current width). Used by ctrl+l,
   * ctrl+o and /clear only: terminal resizes are handled by a settled re-layout
   * (below) plus the reflow-aware frame writer in index.tsx.
   */
  const redraw = useCallback((clearScrollback = false) => {
    if (stdout?.isTTY) stdout.write(`\x1b[2J${clearScrollback ? '\x1b[3J' : ''}\x1b[H`);
    setGeneration((g) => g + 1);
  }, [stdout]);
  const clearScreen = useCallback(() => redraw(false), [redraw]);

  // Re-layout once the terminal size has settled (Ink's own per-event resize
  // handler is removed in index.tsx). A state bump is enough: Ink recomputes the
  // layout at the current width on every React commit, and the frame writer erases
  // the previous frame with the row count it really occupies at that width.
  const [resizeTick, setResizeTick] = useState(0);
  useEffect(() => {
    if (!stdout?.isTTY) return;
    let timer: NodeJS.Timeout | null = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; setResizeTick((t) => t + 1); }, 120);
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
      if (timer) clearTimeout(timer);
    };
  }, [stdout]);

  const addSystem = useCallback((text: string, kind: 'command' | 'notice' | 'compact' | 'normal' | 'bash' = 'command') => {
    agentRef.current?.addSystemMessage(text, kind);
  }, []);

  const applyMode = useCallback((next: PermissionMode) => {
    agentRef.current?.setPermissionMode(next);
    config.permissionMode = next;
    setMode(next);
  }, [config]);

  const cycleMode = useCallback(() => {
    const current = agentRef.current?.permissionMode ?? mode;
    const order: PermissionMode[] = PERMISSION_MODES;
    applyMode(order[(order.indexOf(current) + 1) % order.length]);
  }, [applyMode, mode]);

  const handleExit = useCallback(async () => {
    const agent = agentRef.current;
    if (agent) {
      agent.interrupt();
      await agent.flush();
      onExitSummary?.(`✻ ${APP_NAME} session ${agent.sessionId} saved · ${agent.usage.cumulativeTokens.toLocaleString('en-US')} tokens · resume with fuller --continue`);
    }
    exit();
  }, [exit, onExitSummary]);

  const transcriptMarkdown = useCallback(() => {
    const agent = agentRef.current;
    if (!agent) return '';
    const parts: string[] = [`# ${APP_NAME} — conversation ${agent.sessionId}`, '', `- Model: ${config.model}`, `- Directory: ${config.workspaceDir}`, `- Date: ${new Date().toISOString()}`, ''];
    for (const m of agent.getMessages()) {
      if (m.role === 'user') parts.push(`## ❯ User\n\n${m.content}\n`);
      else if (m.role === 'system') parts.push(`> ${m.content.replace(/\n/g, '\n> ')}\n`);
      else {
        parts.push(`## ⏺ ${APP_NAME}\n`);
        for (const p of m.parts ?? []) {
          if (p.type === 'text') parts.push(`${p.content}\n`);
          else parts.push(`\`\`\`\n${p.toolCall.name}(${JSON.stringify(p.toolCall.args).slice(0, 500)})\n→ ${p.toolCall.status}${p.toolCall.summary ? ` · ${p.toolCall.summary}` : ''}\n${(p.toolCall.result ?? p.toolCall.error ?? '').slice(0, 2000)}\n\`\`\`\n`);
        }
      }
    }
    return parts.join('\n');
  }, [config.model, config.workspaceDir]);

  const commandContext = useCallback((): CommandContext | null => {
    const agent = agentRef.current;
    if (!agent) return null;
    return {
      agent,
      config,
      gitInfo,
      theme,
      verbose,
      usage,
      startedAt: startedAt.current,
      addSystem,
      setTheme: (name) => { saveTheme(name); setThemeState(resolveTheme(name)); },
      setMode: applyMode,
      cycleMode,
      clearConversation: () => {
        agent.clearHistory();
        setTodos([]);
        setItems([{ key: 'banner', kind: 'banner' }]);
        setRestored(undefined);
        redraw(true);
      },
      exit: () => void handleExit(),
      openRewind: () => setRewindOpen(true),
      toggleVerbose: () => { setVerbose((v) => !v); clearScreen(); },
      transcriptMarkdown,
      addDir: (dir) => { config.additionalDirectories.push(dir); },
      openModelPicker: () => setModelPickerOpen(true),
      setContextWindow: (tokens) => agent.setContextWindow(tokens),
      skills,
      reloadSkills: () => { const next = agent.reloadSkills(); setSkills(next); return next; },
    };
  }, [config, gitInfo, theme, verbose, usage, addSystem, applyMode, cycleMode, clearScreen, redraw, handleExit, transcriptMarkdown, skills]);

  const menuCommands = useMemo<SlashCommand[]>(() => [
    ...COMMANDS,
    ...skills.filter((sk) => sk.userInvocable).map<SlashCommand>((sk) => ({
      name: `/${sk.name}`,
      description: `${sk.description || sk.kind} (${sk.scope})`,
      usage: sk.argumentHint,
      takesArg: !!sk.argumentHint,
      run: () => {},
    })),
  ], [skills]);

  const onSubmit = useCallback((text: string) => {
    appendPromptHistory(config.workspaceDir, text);
    void agentRef.current?.handleUserInput(text);
  }, [config.workspaceDir]);

  const onCommand = useCallback((cmd: string) => {
    appendPromptHistory(config.workspaceDir, cmd);
    const ctx = commandContext();
    if (ctx) void runCommand(cmd, ctx).then(() => setModel(config.model));
  }, [commandContext, config.workspaceDir, config]);

  const onBash = useCallback((cmd: string) => {
    appendPromptHistory(config.workspaceDir, '!' + cmd);
    void agentRef.current?.runShell(cmd);
  }, [config.workspaceDir]);

  const onInterrupt = useCallback(() => agentRef.current?.interrupt(), []);
  const onToggleVerbose = useCallback(() => { setVerbose((v) => !v); clearScreen(); }, [clearScreen]);
  const onToggleHelp = useCallback(() => setShowHelp((h) => !h), []);
  const onToggleTodos = useCallback(() => setShowTodos((v) => !v), []);
  const statusLine = useStatusLine(config, { sessionId, model, mode, status, usage, startedAt: startedAt.current });
  const onDoubleEscape = useCallback(() => { if (!agentRef.current?.busy) setRewindOpen(true); }, []);
  const onPopQueue = useCallback(() => agentRef.current?.popQueue(), []);
  const onInputState = useCallback((s: { empty: boolean; bashMode: boolean }) => setInputState(s), []);

  // ------------------------------------------------------------ screens
  if (!config.apiKey) {
    return (
      <ThemeProvider theme={theme}>
        <Box flexDirection="column" borderStyle="round" borderColor={theme.error} paddingX={1}>
          <Text bold color={theme.error}>✗ Missing GEMINI_API_KEY</Text>
          <Text>Set your Gemini API key (https://aistudio.google.com/apikey) with one of:</Text>
          <Text color={theme.subtle}>  export GEMINI_API_KEY=your_key      ·  fuller --key your_key</Text>
          <Text color={theme.subtle}>  echo "GEMINI_API_KEY=your_key" &gt;&gt; .env</Text>
        </Box>
      </ThemeProvider>
    );
  }

  if (screen === 'picker') {
    const sessions = listSessions(config.workspaceDir);
    return (
      <ThemeProvider theme={theme}>
        <SessionPicker
          sessions={sessions}
          onSelect={(id) => { setRestored(loadSession(config.workspaceDir, id) ?? undefined); setScreen('main'); }}
          onCancel={() => setScreen('main')}
        />
      </ThemeProvider>
    );
  }

  const modalOpen = confirmation !== null || rewindOpen || modelPickerOpen;
  const liveMaxLines = Math.max(4, rows - 16 - (live?.tools.length ?? 0) * 2);

  return (
    <ThemeProvider theme={theme}>
      <Static key={generation} items={items}>
        {(item) => <TranscriptItemView key={item.key} item={item} verbose={verbose} banner={bannerProps} />}
      </Static>
      <Box flexDirection="column">
        {live ? <LiveArea live={live} verbose={verbose} frame={frame} maxLines={liveMaxLines} /> : null}
        {status !== 'idle' && status !== 'awaiting_permission' ? (
          <Box marginTop={1} paddingX={1}>
            <SpinnerLine status={status} startedAt={turnStartedAt} responseTokens={live?.text ? Math.round(live.text.length / 4) : 0} verbs={config.settings.spinnerVerbs} frame={frame} />
          </Box>
        ) : null}
        {notice ? (
          <Box paddingX={1} marginTop={1}>
            <Text color={notice.level === 'error' ? theme.error : notice.level === 'warn' ? theme.warning : theme.subtle}>{notice.text}</Text>
          </Box>
        ) : null}
        {showTodos && todos.length > 0 && todos.some((t) => t.status !== 'completed') && !confirmation ? (
          <TodoPanel todos={todos} frame={frame} maxItems={Math.max(3, Math.min(6, rows - 18))} />
        ) : null}
        {confirmation ? <PermissionPrompt confirmation={confirmation} verbose={verbose} maxDiffLines={Math.max(8, rows - 14)} /> : null}
        {modelPickerOpen && !confirmation ? (
          <ModelPicker
            apiKey={config.apiKey}
            current={model}
            onCancel={() => setModelPickerOpen(false)}
            onSelect={(m) => {
              setModelPickerOpen(false);
              agentRef.current?.switchModel(m.id);
              if (m.inputTokenLimit) agentRef.current?.setContextWindow(m.inputTokenLimit);
              setModel(m.id);
              addSystem(`Model switched to **${m.id}** (${m.displayName}, ${Math.round(m.inputTokenLimit / 1024)}k context). Conversation history kept.`);
            }}
          />
        ) : null}
        {rewindOpen && !confirmation ? (
          <RewindMenu
            checkpoints={agentRef.current?.getCheckpoints() ?? []}
            onCancel={() => setRewindOpen(false)}
            onRestore={(id) => {
              setRewindOpen(false);
              try {
                const files = agentRef.current?.rewindTo(id) ?? [];
                addSystem(files.length ? `↺ Restored ${files.length} file${files.length === 1 ? '' : 's'}:\n${files.map((f) => `- ${f}`).join('\n')}` : 'Nothing to restore.');
              } catch (err: any) {
                addSystem(`✗ Rewind failed: ${err.message}`, 'notice');
              }
            }}
          />
        ) : null}
        <Box flexDirection="column" marginTop={1} display={modalOpen ? 'none' : 'flex'}>
          <InputBox
            isActive={!modalOpen}
            busy={status !== 'idle'}
            queue={queue}
            history={history}
            cwd={config.workspaceDir}
            commands={menuCommands}
            showHelp={showHelp}
            onSubmit={onSubmit}
            onCommand={onCommand}
            onBash={onBash}
            onInterrupt={onInterrupt}
            onExit={() => void handleExit()}
            onCycleMode={cycleMode}
            onClearScreen={clearScreen}
            onToggleVerbose={onToggleVerbose}
            onToggleHelp={onToggleHelp}
            onToggleTodos={onToggleTodos}
            onDoubleEscape={onDoubleEscape}
            onPopQueue={onPopQueue}
            onStateChange={onInputState}
          />
          <Footer
            mode={mode}
            status={status}
            usage={usage}
            autoCompactThreshold={config.autoCompactThreshold}
            model={model}
            inputEmpty={inputState.empty}
            bashMode={inputState.bashMode}
            statusLine={statusLine}
            statusLinePadding={config.settings.statusLine?.padding}
            backgroundTasks={backgroundRunning}
          />
        </Box>
      </Box>
    </ThemeProvider>
  );
};
