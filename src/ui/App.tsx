import path from 'node:path';
import fs from 'node:fs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useStdout, measureElement, type DOMElement } from 'ink';
import { ThemeProvider, loadSyntaxHighlighting, loadTheme, loadThemeName, resolveTheme, saveTheme, type Theme } from './theme.js';
import { Banner } from './Banner.js';
import type { FrameWriter } from './frameWriter.js';
import { TerminalInputEnabled, useTerminalHandoff } from './useTerminalHandoff.js';
import { TranscriptItemView } from './Transcript.js';
import { LiveArea } from './LiveArea.js';
import { SpinnerLine, useSpinnerFrame } from './Spinner.js';
import { PermissionPrompt } from './PermissionPrompt.js';
import { RewindMenu } from './RewindMenu.js';
import { ModelPicker } from './ModelPicker.js';
import { ThemePicker, themeLabel } from './ThemePicker.js';
import { knownContextWindow } from '../agent/models.js';
import { SessionPicker } from './SessionPicker.js';
import { AgentsView } from './AgentsView.js';
import { QuotaDialog } from './QuotaDialog.js';
import type { ModelUsage } from '../agent/keyPool.js';
import { loadCommandUsage, recordCommandUsage, type CommandUsage } from '../session/commandUsage.js';
import { HelpDialog, SettingsDialog, ListDialog, InputDialog } from './InfoDialogs.js';
import { PermissionsDialog } from './PermissionsDialog.js';
import { BtwPanel } from './BtwPanel.js';
import { EffortDialog } from './EffortDialog.js';
import { colored, stripSegments } from './segments.js';
import { copyToClipboard } from '../utils/clipboard.js';
import { InputBox } from './InputBox.js';
import { Footer, PromptHints, EFFORT_GLYPHS } from './Footer.js';
import { effectiveThinkingLevel, supportedThinkingLevels, type ThinkingLevelSetting } from '../agent/thinking.js';
import { ShortcutsHelp, SHORTCUTS_HELP_EXTRA_ROWS } from './ShortcutsHelp.js';
import { SUGGESTION_LINES } from './SlashMenu.js';
import { editorName, resolveEditor } from './externalEditor.js';
import { spawnSync } from 'node:child_process';
import { Pager } from './Pager.js';
import { editPromptExternally } from './externalEditor.js';
import { FullscreenTranscript, useTranscriptRows, type ScrollAction } from './FullscreenTranscript.js';
import { transcriptLines } from './viewerText.js';
import { readFileDiffs, isTestOrGenerated, nextDiffBase, defaultBranch, type FileDiff, type DiffBase } from './gitDiff.js';
import { DiffViewer, turnViews, type DiffViewerData } from './DiffViewer.js';
import { saveUserSetting, saveProjectLocalSetting } from '../config.js';
import { DiffPanel, diffPanelClick, maxPanelScroll, panelSelection, type DiffPanelState, type PanelSelection } from './DiffPanel.js';
import { toolLabel, toolArgSummary } from '../tools/registry.js';
import { TodoPanel } from './TodoPanel.js';
import { useStatusLine } from './useStatusLine.js';
import { COMMANDS, runCommand, type CommandContext, type SlashCommand, type InfoDialog } from './commands.js';
import { getPromptSuggestion } from './suggestions.js';
import { modelLabel } from './modelLabel.js';
import type { SkillDefinition } from '../skills/loader.js';
import type { ImageAttachment } from '../utils/imageClipboard.js';
import { AgentLoop, type AgentCallbacks, type ModelSwitchRequest } from '../agent/loop.js';
import { loadProjectContext } from '../agent/contextLoader.js';
import { messagesToTranscript } from '../agent/transcript.js';
import { getGitInfo, type GitInfo } from '../utils/git.js';
import { deleteSession, listAllSessions, listSessions, loadSession, renameStoredSession, type SessionData } from '../session/store.js';
import { loadPromptHistory, appendPromptHistory } from '../session/history.js';
import { APP_NAME, APP_SLUG, STARTUP_TIPS, STARTUP_TIP_CHANCE } from '../branding.js';
import { saveDefaultModel, type AppConfig, DEFAULT_MODEL } from '../config.js';
import type { BannerProps } from './Banner.js';
import type {
  AgentStatus, LiveTurn, Notice, PendingConfirmation, PermissionMode, TranscriptItem, UsageInfo, TodoItem, MessageKind, AgentTask } from '../agent/types.js';
import { CYCLE_MODES } from '../agent/types.js';

/** Claude Code opens /diff beside the conversation from 110 columns. */
const DIFF_PANEL_MIN_COLUMNS = 110;
/** Claude Code opens the panel on its own at the first edit from this width, until /diff has been used. */
const DIFF_PANEL_AUTO_COLUMNS = 144;
/** Ink's columns are one short of the terminal; the panel takes 45 % of the terminal, the conversation the rest. */
function diffPanelLayout(inkColumns: number): { left: number; panel: number } {
  const columns = inkColumns + 1;
  const left = columns - Math.floor(columns * 0.45);
  return { left, panel: inkColumns - left };
}

/** As Claude Code: a conversation from another directory is resumed from there (the command is copied). */
function otherDirectoryNotice(id: string, workspaceDir: string): string {
  const command = `cd ${/\s/.test(workspaceDir) ? JSON.stringify(workspaceDir) : workspaceDir} && ${APP_SLUG} --resume ${id}`;
  void copyToClipboard(command).catch(() => {});
  return `This conversation is from a different directory.\n\nTo resume, run:\n  ${command}\n\n(Command copied to clipboard)`;
}

export interface AppProps {
  config: AppConfig;
  initialPrompt?: string;
  restoredSession?: SessionData;
  pickSession?: boolean;
  onExitSummary?: (summary: string) => void;
  frameWriter?: FrameWriter;
  fullscreen?: boolean;
}

export const App: React.FC<AppProps> = ({ config, initialPrompt, restoredSession, pickSession, onExitSummary, frameWriter, fullscreen = false }) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [theme, setThemeState] = useState<Theme>(() => ({ ...loadTheme(config.settings.theme), syntaxHighlighting: loadSyntaxHighlighting() }));
  const [themeName, setThemeName] = useState(() => loadThemeName(config.settings.theme));
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const themeBeforePicker = useRef<Theme | null>(null);
  const [screen, setScreen] = useState<'picker' | 'main'>(pickSession ? 'picker' : 'main');
  const startupNotice = useRef<string | null>(null);
  // /resume inside a session: the picker overlay, and a counter that rebuilds the agent from `restored`.
  const [resumeOpen, setResumeOpen] = useState(false);
  const [infoDialog, setInfoDialog] = useState<InfoDialog | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [restored, setRestored] = useState<SessionData | undefined>(restoredSession);
  const [items, setItems] = useState<TranscriptItem[]>(pickSession ? [] : [{ key: 'banner', kind: 'banner' }]);
  const [generation, setGeneration] = useState(0);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  // The model has no key left and the policy is ask: the quota dialog.
  const [modelSwitch, setModelSwitch] = useState<ModelSwitchRequest | null>(null);
  // One bar for the model in use, summed over every key.
  const [quota, setQuota] = useState<ModelUsage | null>(null);
  const [mode, setMode] = useState<PermissionMode>(config.permissionMode);
  const [usage, setUsage] = useState<UsageInfo>({ promptTokens: 0, responseTokens: 0, cumulativeTokens: 0, contextWindow: config.contextWindow, apiCalls: 0, turns: 0 });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  // Normal view is condensed like Claude Code; ctrl+o shows the detailed transcript.
  const [verbose, setVerbose] = useState(false);
  const [viewer, setViewer] = useState<'transcript' | 'diff' | null>(null);
  // ← on an empty prompt: the agents view, its agents, and the report opened from it.
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [agentReport, setAgentReport] = useState<AgentTask | null>(null);
  const agentsCtrlC = useRef(0);
  const startedInBypass = useRef(config.permissionMode === 'bypassPermissions');
  const [commandUsage, setCommandUsage] = useState<CommandUsage>(() => loadCommandUsage());
  const [diffData, setDiffData] = useState<DiffViewerData>({ current: [], currentBase: 'none', turns: [] });
  const [scrollRequest, setScrollRequest] = useState<{ id: number; direction: ScrollAction }>({ id: 0, direction: 'up' });
  const [showHelp, setShowHelp] = useState(false);
  const [rewindOpen, setRewindOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [model, setModel] = useState(config.model);
  const [thinking, setThinking] = useState(config.thinkingLevel);
  const transcriptBox = useRef<DOMElement | null>(null);
  const [measuredTranscriptHeight, setMeasuredTranscriptHeight] = useState<number | undefined>(undefined);
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [showTodos, setShowTodos] = useState(true);
  const [sessionId, setSessionId] = useState('');
  const [backgroundRunning, setBackgroundRunning] = useState(0);
  const [gitInfo, setGitInfo] = useState<GitInfo | undefined>();
  const [inputState, setInputState] = useState<{ empty: boolean; bashMode: boolean; menuOpen: boolean; hint?: string; multiline?: boolean; killed?: boolean; stashed?: boolean; searching?: boolean }>({ empty: true, bashMode: false, menuOpen: false });
  const [turnStartedAt, setTurnStartedAt] = useState(Date.now());
  const agentRef = useRef<AgentLoop | null>(null);
  const { runInTerminal, terminalActive } = useTerminalHandoff(frameWriter, fullscreen, () => agentRef.current?.interrupt());
  const statusRef = useRef<AgentStatus>('idle');
  const startedAt = useRef(Date.now());
  const startupTip = useRef(Math.random() < STARTUP_TIP_CHANCE ? STARTUP_TIPS[Math.floor(Math.random() * STARTUP_TIPS.length)] : undefined);
  const history = useMemo(() => loadPromptHistory(config.workspaceDir), [config.workspaceDir]);
  const allHistory = useMemo(() => loadPromptHistory(config.workspaceDir, Infinity, 'all'), [config.workspaceDir]);
  const memoryFiles = useMemo(() => loadProjectContext(config.workspaceDir).map((file) => file.path), [config.workspaceDir]);
  const frame = useSpinnerFrame(!terminalActive && status !== 'idle' && status !== 'awaiting_permission');
  const rows = stdout?.rows ?? 24;
  const viewedTranscript = useMemo(() => transcriptLines(items, true), [items]);


  useEffect(() => {
    if (fullscreen || process.env.FULLER_DISABLE_MOUSE === '1' || !process.stdout.isTTY) return;
    if (screen !== 'picker' && !modelPickerOpen && !rewindOpen && !viewer) return;
    process.stdout.write('\x1b[?1000h\x1b[?1006h');
    return () => { process.stdout.write('\x1b[?1000l\x1b[?1006l'); };
  }, [fullscreen, screen, modelPickerOpen, rewindOpen, viewer]);

  // /diff: at 110 columns and more in fullscreen, Claude Code's panel beside the conversation.
  const [diffPanel, setDiffPanel] = useState<DiffPanelState | null>(null);
  /** Null outside a git repository. */
  const loadDiffPanel = useCallback((showOthers = false, scroll = 0, showSkipped = false, baseArg?: DiffBase): DiffPanelState | null => {
    // The base is remembered per project (Claude Code): this session, uncommitted, or since the default branch.
    const base: DiffBase = baseArg ?? config.settings.diffBase ?? 'session';
    const all = readFileDiffs(config.workspaceDir, base === 'branch' ? 'branch' : 'uncommitted');
    if (!all) return null;
    const edited = new Set(agentRef.current?.sessionEditedFiles() ?? []);
    // The list leaves out test and generated files, behind a count line; the earlier changes keep theirs.
    const listed = base === 'session' ? all.filter((f) => edited.has(f.file)) : all;
    const others = base === 'session' ? all.filter((f) => !edited.has(f.file)) : [];
    return {
      files: listed.filter((f) => !isTestOrGenerated(f.file)),
      skipped: listed.filter((f) => isTestOrGenerated(f.file)),
      others, showOthers, showSkipped, scroll, base,
      branch: base === 'branch' ? defaultBranch(config.workspaceDir) : undefined,
    };
  }, [config]);
  // Claude Code remembers the panel across sessions: opened with /diff, it opens on its own at 110
  // columns; closed, it stays closed until /diff again; never used, it opens on its own from 144.
  const setDiffPreference = useCallback((value: 'opened' | 'closed') => {
    config.settings.diffPanel = value;
    try { saveUserSetting(['diffPanel'], value); } catch {}
  }, [config]);
  /** Current: uncommitted changes, or what the branch adds on top of the default branch; then one view per turn with edits. */
  const loadDiffViewer = useCallback((): DiffViewerData => {
    const uncommitted = readFileDiffs(config.workspaceDir, 'uncommitted') ?? [];
    const turns = turnViews(agentRef.current?.getMessages() ?? []);
    if (uncommitted.length) return { current: uncommitted, currentBase: 'uncommitted', turns };
    const branch = defaultBranch(config.workspaceDir);
    const since = branch ? readFileDiffs(config.workspaceDir, 'branch') ?? [] : [];
    return { current: since, currentBase: since.length ? 'branch' : 'none', branch, turns };
  }, [config.workspaceDir]);
  const openDiffViewer = useCallback(() => {
    const columns = (stdout?.columns ?? 80) + 1;
    // Claude Code 2.1.282 only has the panel: narrower, it says how wide the terminal must be.
    if (fullscreen && columns < DIFF_PANEL_MIN_COLUMNS) {
      agentRef.current?.addCommandMessage('/diff');
      addSystem(`Resize your terminal to at least ${DIFF_PANEL_MIN_COLUMNS} columns to show the diff panel`, 'notice');
      return;
    }
    if (fullscreen && (diffPanelRef.current || readFileDiffs(config.workspaceDir))) {
      agentRef.current?.addCommandMessage('/diff');
      addSystem(diffPanelRef.current ? 'Diff panel hidden' : 'Diff panel shown', 'notice');
      if (diffPanelRef.current) { setDiffPanel(null); setDiffPreference('closed'); return; }
      setDiffPreference('opened');
      // Reading every change can take a moment in a big tree: open the panel first.
      setDiffPanel({ files: [], others: [], showOthers: false, loading: true });
      setTimeout(() => { if (diffPanelRef.current) setDiffPanel(loadDiffPanel()); }, 0);
      return;
    }
    // Classic renderer, or no git repository for the panel: the viewer (Claude Code's Current and turn views).
    setDiffData(loadDiffViewer());
    setViewer((v) => (v === 'diff' ? null : 'diff'));
  }, [config.workspaceDir, fullscreen, stdout, loadDiffPanel, loadDiffViewer, setDiffPreference]);
  const diffPanelRef = useRef(diffPanel);
  diffPanelRef.current = diffPanel;
  // The panel follows the agent's work: refreshed after each edit or shell command, and at the end of
  // a turn; the first edit opens it in a wide enough terminal (Claude Code's diff panel).
  const diffRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The panel's height, known once the layout is computed below. */
  const diffPanelHeight = useRef(24);
  const refreshDiffPanel = useCallback(() => {
    if (diffRefresh.current) clearTimeout(diffRefresh.current);
    diffRefresh.current = setTimeout(() => {
      diffRefresh.current = null;
      const current = diffPanelRef.current;
      if (current) setDiffPanel(loadDiffPanel(current.showOthers, current.scroll, current.showSkipped, current.base) ?? current);
    }, 100);
  }, [loadDiffPanel]);
  // Ctrl+X B while the panel is open: the next base, remembered for this project (.fuller/settings.local.json).
  const cycleDiffBase = useCallback(() => {
    const current = diffPanelRef.current;
    if (!current) return;
    const base = nextDiffBase(current.base ?? 'session');
    config.settings.diffBase = base;
    try { saveProjectLocalSetting(config.workspaceDir, ['diffBase'], base); } catch {}
    setDiffPanel({ ...current, base, loading: true });
    setTimeout(() => { const now = diffPanelRef.current; if (now) setDiffPanel(loadDiffPanel(now.showOthers, 0, now.showSkipped, base) ?? now); }, 0);
  }, [config, loadDiffPanel]);
  // Lines selected with the mouse in the panel go with the next prompt (Claude Code): the input shows
  // "[N lines selected] " until it is sent; delete that token to send without them.
  const [lineSelection, setLineSelection] = useState<PanelSelection | null>(null);
  const [injected, setInjected] = useState<{ id: number; text: string } | undefined>(undefined);
  const pressRow = useRef<number | null>(null);
  const selectionToken = (count: number) => `[${count} line${count === 1 ? '' : 's'} selected] `;
  const onPanelRelease = useCallback((x: number, y: number) => {
    const current = diffPanelRef.current;
    const from = pressRow.current;
    pressRow.current = null;
    if (!current || from === null) return;
    const { left, panel } = diffPanelLayout(stdout?.columns ?? 80);
    if (x - 1 < left) return;
    const picked = panelSelection(current, panel, diffPanelHeight.current, from, y - 1);
    if (!picked) return;
    setLineSelection(picked);
    setInjected({ id: Date.now(), text: selectionToken(picked.lines.length) });
  }, [stdout]);
  const onToolDone = useCallback((name: string) => {
    if (!fullscreen) return;
    if (diffPanelRef.current) {
      if (['edit_file', 'write_file', 'execute_bash', 'agent'].includes(name)) refreshDiffPanel();
      return;
    }
    if (name !== 'edit_file' && name !== 'write_file') return;
    const preference = config.settings.diffPanel ?? 'auto';
    const columns = (stdout?.columns ?? 80) + 1;
    if (preference === 'closed' || columns < (preference === 'opened' ? DIFF_PANEL_MIN_COLUMNS : DIFF_PANEL_AUTO_COLUMNS)) return;
    const next = loadDiffPanel();
    if (next) setDiffPanel(next);
  }, [fullscreen, config, stdout, loadDiffPanel, refreshDiffPanel]);
  const onToolDoneRef = useRef(onToolDone);
  onToolDoneRef.current = onToolDone;
  useEffect(() => {
    if (status === 'idle' && diffPanelRef.current) refreshDiffPanel();
  }, [status, refreshDiffPanel]);
  const scrollDiffPanel = useCallback((delta: number) => {
    const current = diffPanelRef.current;
    if (!current) return;
    const { panel } = diffPanelLayout(stdout?.columns ?? 80);
    const max = maxPanelScroll(current, panel, diffPanelHeight.current);
    setDiffPanel({ ...current, scroll: Math.max(0, Math.min(max, (current.scroll ?? 0) + delta)) });
  }, [stdout]);


  const bannerProps: BannerProps = useMemo(() => ({
    model,
    workspaceDir: config.workspaceDir,
    gitBranch: gitInfo?.isGit ? gitInfo.branch : undefined,
    gitDirty: gitInfo?.isDirty,
    tip: startupTip.current,
    resumed: restored?.meta.id,
    memoryFiles,
  }), [model, config.workspaceDir, gitInfo, restored, memoryFiles]);
  const noItems = useMemo<TranscriptItem[]>(() => [], []);
  // ctrl+o: the detailed transcript drawn like the conversation (Claude Code's transcript mode).
  const detailedLines = useTranscriptRows({
    items: viewer === 'transcript' ? items : noItems,
    live: null,
    verbose: true,
    banner: bannerProps,
    frame,
    permissionOpen: false,
    width: Math.max(20, (stdout?.columns ?? 80) - 2),
  });
  const fullscreenLines = useTranscriptRows({
    items: fullscreen ? items : noItems,
    live: fullscreen ? live : null,
    verbose,
    banner: bannerProps,
    frame,
    permissionOpen: !!confirmation,
    width: Math.max(20, diffPanel ? diffPanelLayout(stdout?.columns ?? 80).left : stdout?.columns ?? 80),
  });

  const bell = useCallback((event: 'permission' | 'done' | 'error') => {
    if (config.notifications === 'off') return;
    if (config.notifications === 'permission' && event === 'done') return;
    if (stdout?.isTTY) stdout.write('\x07');
  }, [config.notifications, stdout]);

  // ------------------------------------------------------------ agent bootstrap
  useEffect(() => {
    if (screen !== 'main' || !config.apiKey) return;
    const callbacks: AgentCallbacks = {
      runInTerminal,
      onStatusChange: (s) => {
        if (s !== 'idle' && statusRef.current === 'idle') setTurnStartedAt(Date.now());
        statusRef.current = s;
        setStatus(s);
      },
      onCommit: (item) => {
        setItems((prev) => [...prev, item]);
        if (item.kind === 'tool' && item.toolCall.status === 'completed') onToolDoneRef.current(item.toolCall.name);
      },
      onTranscriptReset: (next) => { setItems([{ key: 'banner', kind: 'banner' }, ...next]); redraw(!fullscreen); },
      onLive: setLive,
      onRequestConfirmation: setConfirmation,
      onRequestModelSwitch: setModelSwitch,
      onQuotaChange: setQuota,
      onUsage: (u) => { setUsage(u); setQuota(agentRef.current?.quotaUsage() ?? null); },
      onNotice: setNotice,
      onQueueChange: setQueue,
      onModeChange: setMode,
      onModelChange: setModel,
      onNotify: bell,
      onTodosChange: (t) => { setTodos(t); if (t.some((x) => x.status !== 'completed')) setShowTodos(true); },
      onBackgroundChange: (running) => setBackgroundRunning(running),
      onAgentsChange: (tasks) => setAgentTasks(tasks),
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
    // `fuller --resume` then a session of another directory (Ctrl+A): say how to resume it.
    if (startupNotice.current) { agent.addSystemMessage(startupNotice.current, 'notice'); startupNotice.current = null; }
    getGitInfo(config.workspaceDir).then((info) => {
      setGitInfo(info);
      agent.setGitBranch(info.isGit ? info.branch : undefined);
    });
    if (initialPrompt && sessionEpoch === 0) void agent.handleUserInput(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, sessionEpoch]);

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
    stdout.on('fuller:resize', onResize);
    return () => {
      stdout.off('fuller:resize', onResize);
      if (timer) clearTimeout(timer);
    };
  }, [stdout]);

  const addSystem = useCallback((text: string, kind: MessageKind = 'command') => {
    agentRef.current?.addSystemMessage(text, kind);
  }, []);

  // /effort and its dialog: apply a level to the session, and save it as the default with Enter.
  const applyEffort = (level: ThinkingLevelSetting, scope: 'default' | 'session') => {
    if (scope === 'default') {
      try {
        saveDefaultModel(config.settings.model || config.model, undefined, level);
        config.settings.thinkingLevel = level;
      } catch (err: any) {
        addSystem(`Could not save the effort level: ${err.message || String(err)}. Using it for this session.`, 'notice');
      }
    }
    agentRef.current?.switchModel(model, level);
    config.thinkingLevel = level;
    setThinking(level);
    addSystem(`Set effort level to ${level}${scope === 'session' ? ' for this session only' : ''}`, 'notice');
  };

  const applyMode = useCallback((next: PermissionMode) => {
    agentRef.current?.setPermissionMode(next);
    config.permissionMode = next;
    setMode(next);
  }, [config]);

  const cycleMode = useCallback(() => {
    const current = agentRef.current?.permissionMode ?? mode;
    const order: PermissionMode[] = startedInBypass.current ? [...CYCLE_MODES, 'bypassPermissions'] : CYCLE_MODES;
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
      else if (m.role === 'system') parts.push(`> ${stripSegments(m.content).replace(/\n/g, '\n> ')}\n`);
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
      setTheme: (name) => { saveTheme(name); setThemeName(name); setThemeState({ ...resolveTheme(name), syntaxHighlighting: theme.syntaxHighlighting }); },
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
      toggleVerbose: () => setViewer((v) => (v === 'transcript' ? null : 'transcript')),
      openDiffViewer,
      transcriptMarkdown,
      addDir: (dir) => { config.additionalDirectories.push(dir); },
      openModelPicker: () => setModelPickerOpen(true),
      openThemePicker: () => { themeBeforePicker.current = theme; setThemePickerOpen(true); },
      openSessionPicker: () => setResumeOpen(true),
      openDialog: setInfoDialog,
      effort: () => ({ levels: supportedThinkingLevels(model), current: effectiveThinkingLevel(model, thinking) }),
      setEffort: (level, scope) => applyEffort(level, scope),
      editFile: (file, initialContent = '') => {
        try { if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, initialContent, 'utf8'); } } catch {}
        void runInTerminal(async () => {
          const parts = resolveEditor().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? ['vi'];
          spawnSync(parts[0], [...parts.slice(1), file], { stdio: 'inherit' });
        }).catch((err) => addSystem(`Could not open the editor: ${err?.message ?? err}`, 'notice'));
      },
      setContextWindow: (tokens) => agent.setContextWindow(tokens),
      skills,
      reloadSkills: () => { const next = agent.reloadSkills(); setSkills(next); return next; },
    };
  }, [config, gitInfo, theme, verbose, usage, addSystem, applyMode, cycleMode, clearScreen, redraw, handleExit, transcriptMarkdown, skills, openDiffViewer, fullscreen, model, thinking]);

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

  const onSubmit = useCallback((text: string, attachments: ImageAttachment[] = []) => {
    appendPromptHistory(config.workspaceDir, text);
    const options: { attachments?: ImageAttachment[]; prompt?: string } = attachments.length ? { attachments } : {};
    const selection = lineSelectionRef.current;
    if (selection) {
      const token = selectionToken(selection.lines.length).trim();
      // The token was deleted from the input: the prompt goes without the lines (Claude Code).
      if (text.includes(token)) options.prompt = `${text.replace(token, '').trim()}\n\nSelected lines from ${selection.file} (diff panel):\n\`\`\`diff\n${selection.lines.join('\n')}\n\`\`\``;
      setLineSelection(null);
    }
    void agentRef.current?.handleUserInput(text, 'normal', options);
  }, [config.workspaceDir]);
  const lineSelectionRef = useRef<PanelSelection | null>(null);
  lineSelectionRef.current = lineSelection;

  const onSendNow = useCallback((text: string, attachments: ImageAttachment[]) => {
    if (text.trim()) appendPromptHistory(config.workspaceDir, text);
    void agentRef.current?.sendNow(text, attachments);
  }, [config.workspaceDir]);

  const onCommand = useCallback((cmd: string) => {
    appendPromptHistory(config.workspaceDir, cmd);
    const name = cmd.split(/\s/)[0];
    if (menuCommands.some((c) => c.name === name)) { recordCommandUsage(name); setCommandUsage(loadCommandUsage()); }
    if (cmd === '/model' || cmd.startsWith('/model ')) agentRef.current?.addCommandMessage(cmd);
    const ctx = commandContext();
    if (ctx) void runCommand(cmd, ctx).then(() => setModel(config.model));
  }, [commandContext, config.workspaceDir, config, menuCommands]);

  const onBash = useCallback((cmd: string) => {
    appendPromptHistory(config.workspaceDir, '!' + cmd);
    void agentRef.current?.runShell(cmd);
  }, [config.workspaceDir]);

  const onInterrupt = useCallback(() => agentRef.current?.interrupt(), []);
  const onToggleHelp = useCallback(() => setShowHelp((h) => !h), []);
  const onToggleTodos = useCallback(() => setShowTodos((v) => !v), []);
  const statusLine = useStatusLine(config, { sessionId, model, mode, status, usage, startedAt: startedAt.current });
  // Claude Code opens the rewind menu only when there is something to rewind to.
  const onDoubleEscape = useCallback(() => { const agent = agentRef.current; if (agent && !agent.busy && agent.getTurnCheckpoints().length > 0) setRewindOpen(true); }, []);
  const suspendNoteShown = useRef(false);
  // ctrl+z: hand the terminal back, stop like a shell job, and resume on SIGCONT (fg).
  const onSuspend = useCallback(() => {
    if (process.platform === 'win32') return;
    const note = suspendNoteShown.current ? '' : 'Note: ctrl + z now suspends Fuller, ctrl + _ undoes input.\r\n';
    suspendNoteShown.current = true;
    void runInTerminal(async () => {
      const resumed = new Promise<void>((resolve) => process.once('SIGCONT', () => resolve()));
      process.kill(process.pid, 'SIGTSTP');
      // Without job control (orphaned process group) the kernel drops SIGTSTP: do not hang.
      // When the stop does happen, this timer only fires after the process is resumed.
      await Promise.race([resumed, new Promise((resolve) => setTimeout(resolve, 300))]);
    }, `${APP_NAME} has been suspended. Run \`fg\` to bring ${APP_NAME} back.\r\n${note}`).catch(() => {});
  }, [runInTerminal]);
  const onPopQueue = useCallback(() => agentRef.current?.popQueue(), []);
  const onInputState = useCallback((s: { empty: boolean; bashMode: boolean; menuOpen: boolean; hint?: string; multiline?: boolean; killed?: boolean; stashed?: boolean; searching?: boolean }) => setInputState(s), []);
  const editor = useMemo(() => editorName(), []);

  const writeTerminal = (text: string) => {
    if (frameWriter) frameWriter.writeStatic(text);
    else stdout.write(text);
  };
  const leaveFullscreen = () => {
    frameWriter?.reset();
    writeTerminal('\x1b[?1000l\x1b[?1006l\x1b[?1049l\x1b[?25h');
  };
  const restoreFullscreen = () => {
    writeTerminal('\x1b[?1049h\x1b[?25l' + (process.env.FULLER_DISABLE_MOUSE === '1' ? '' : '\x1b[?1000h\x1b[?1006h'));
    frameWriter?.reset();
    redraw(false);
  };
  const exportTranscript = () => {
    leaveFullscreen();
    writeTerminal(transcriptLines(items, true).join('\n') + '\n\nEsc or q to return to Fuller.\n');
    return restoreFullscreen;
  };
  const openTranscriptEditor = () => {
    const wasRaw = process.stdin.isRaw;
    leaveFullscreen();
    try {
      if (wasRaw) process.stdin.setRawMode(false);
      editPromptExternally(transcriptLines(items, true).join('\n'));
    } catch (error: any) {
      setNotice({ level: 'error', text: `Editor: ${error.message ?? String(error)}` });
    } finally {
      if (wasRaw) process.stdin.setRawMode(true);
      restoreFullscreen();
    }
  };

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

  // The effort shown in dialog rules, as Claude Code does ("◐ medium · /effort").
  const effortLevel = effectiveThinkingLevel(model, thinking);
  const effortLabel = effortLevel ? `${EFFORT_GLYPHS[effortLevel] ?? '◐'} ${effortLevel} · /effort` : undefined;
  const modalOpen = confirmation !== null || modelSwitch !== null || rewindOpen || modelPickerOpen || themePickerOpen || resumeOpen || infoDialog !== null || viewer !== null || agentsOpen || agentReport !== null;
  const pickerOpen = modelPickerOpen || themePickerOpen || rewindOpen || resumeOpen || infoDialog !== null;
  const pickerTranscriptHeight = rows < 14 ? 0 : Math.max(2, rows - 18);
  const transcriptHeight = pickerOpen ? pickerTranscriptHeight : confirmation ? Math.max(2, rows - (rows < 20 ? 14 : 17)) : Math.max(4, rows - 9 - (showHelp ? SHORTCUTS_HELP_EXTRA_ROWS : 0) - (inputState.menuOpen ? SUGGESTION_LINES - 1 : 0));
  diffPanelHeight.current = measuredTranscriptHeight ?? transcriptHeight;
  // The conversation takes whatever height is left once the prompt, spinner and dialogs are laid out.
  useEffect(() => {
    if (!fullscreen || !transcriptBox.current) return;
    const { height } = measureElement(transcriptBox.current);
    if (height > 0 && height !== measuredTranscriptHeight) setMeasuredTranscriptHeight(height);
  });
  const isBusyEmpty = status !== 'idle' && inputState.empty && queue.length === 0;
  // A permission request can arrive one render before its dialog. Keep the
  // composer out of that transition, including while a child owns the TTY.
  // Claude Code keeps the prompt visible while the model works (grey ❯, "esc to interrupt" in the footer).
  const hideInput = modalOpen || terminalActive || status === 'awaiting_permission';
  const liveMaxLines = Math.max(4, rows - 16 - (live?.tools.length ?? 0) * 2);
  const isInitialWelcome = items.length === 1 && items[0].kind === 'banner' && status === 'idle' && !live && !restored && !initialPrompt &&
    !modalOpen && !showHelp;
  const welcome = fullscreen && isInitialWelcome && rows >= (inputState.menuOpen ? 22 : 15);
  // The hint line above the prompt (effort, input hints) takes the place of the blank line before it.
  const promptMarginTop = welcome ? 0 : isInitialWelcome ? Math.max(2, rows - 16) : 0;
  const suggestion = useMemo(() => {
    return getPromptSuggestion({ items, isGit: gitInfo?.isGit, gitDirty: gitInfo?.isDirty });
  }, [items, gitInfo]);

  // After every hook: returning earlier changes the hook count between renders.
  if (screen === 'picker') {
    const sessions = listSessions(config.workspaceDir);
    return (
      <ThemeProvider theme={theme}>
        <SessionPicker
          sessions={sessions}
          allSessions={() => listAllSessions()}
          onRename={(session, title) => { renameStoredSession(session.workspaceDir, session.id, title); }}
          onDelete={(session) => deleteSession(session.workspaceDir, session.id)}
          onSelect={(id, workspaceDir) => {
            if (path.resolve(workspaceDir) !== path.resolve(config.workspaceDir)) startupNotice.current = otherDirectoryNotice(id, workspaceDir);
            else setRestored(loadSession(config.workspaceDir, id) ?? undefined);
            setScreen('main');
          }}
          onCancel={() => setScreen('main')}
        />
      </ThemeProvider>
    );
  }

  return (
    <TerminalInputEnabled.Provider value={!terminalActive}>
    <ThemeProvider theme={theme}>
      {!fullscreen ? <Static key={generation} items={items}>
        {(item) => <TranscriptItemView key={item.key} item={item} verbose={verbose} banner={bannerProps} />}
      </Static> : null}
      {/* Fullscreen fills the terminal (one row short, or Ink clears the screen on every
          frame) so the prompt sits at the bottom, as in Claude Code. */}
      <Box flexDirection="column" height={welcome || (fullscreen && !viewer) ? rows - 1 : undefined} overflow={fullscreen && !viewer ? 'hidden' : undefined}>
        {fullscreen && welcome ? <Banner {...bannerProps} /> : null}
        {agentReport ? <Pager title={`Agent · ${agentReport.title}`} lines={(agentReport.report ?? '(no report yet)').split('\n')} onClose={() => setAgentReport(null)} /> : null}
        {agentsOpen && !agentReport && !confirmation ? (
          <AgentsView
            tasks={agentTasks}
            model={model}
            workspaceDir={config.workspaceDir}
            mode={mode}
            lastActivity={items.at(-1) && 'timestamp' in items.at(-1)! ? Number((items.at(-1) as any).timestamp) || Date.now() : Date.now()}
            frame={frame}
            onClose={() => setAgentsOpen(false)}
            onStart={(task) => { if (task) agentRef.current?.startAgent(task); }}
            onDelete={(id) => agentRef.current?.deleteAgentTask(id)}
            onOpen={(task) => setAgentReport(task)}
            onCtrlC={() => { const now = Date.now(); if (now - agentsCtrlC.current < 1000) void handleExit(); agentsCtrlC.current = now; }}
          />
        ) : null}
        {viewer === 'diff' ? <DiffViewer data={diffData} onClose={() => setViewer(null)} onRefresh={() => setDiffData(loadDiffViewer())} /> : null}
        {viewer === 'transcript' ? <Pager title="Transcript viewer" status="Showing detailed transcript · ctrl+o to toggle · ? for shortcuts" rightLabel="verbose" lines={detailedLines} ansi sectionPrefix="❯ " onClose={() => setViewer(null)} onToggleDetails={!fullscreen ? () => setVerbose((v) => !v) : undefined} onExport={fullscreen ? exportTranscript : undefined} onOpenEditor={fullscreen ? openTranscriptEditor : undefined} /> : null}
        <Box flexDirection="column" display={viewer || agentReport || (agentsOpen && !confirmation) ? 'none' : 'flex'} flexGrow={welcome || fullscreen ? 1 : undefined}>
        {welcome ? <Box flexGrow={1} /> : null}
        {fullscreen && !welcome ? (
          <Box ref={transcriptBox} flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
            <Box flexDirection="row" flexGrow={1}>
              <Box flexDirection="column" width={diffPanel ? diffPanelLayout(stdout?.columns ?? 80).left : undefined} flexGrow={diffPanel ? 0 : 1}>
                {(!pickerOpen || pickerTranscriptHeight > 0) && (!confirmation || rows >= 16) ? <FullscreenTranscript lines={fullscreenLines} height={measuredTranscriptHeight ?? transcriptHeight} scrollRequest={scrollRequest} width={diffPanel ? diffPanelLayout(stdout?.columns ?? 80).left : undefined} /> : null}
              </Box>
              {diffPanel ? <DiffPanel {...diffPanel} width={diffPanelLayout(stdout?.columns ?? 80).panel} height={measuredTranscriptHeight ?? transcriptHeight} /> : null}
            </Box>
          </Box>
        ) : null}
        {/* Only the conversation may shrink: Yoga would otherwise squeeze dialogs and the prompt. */}
        <Box flexDirection="column" flexShrink={0}>
        {!fullscreen && live && !pickerOpen && (!confirmation || rows >= 20) ? <LiveArea live={live} verbose={verbose} frame={frame} maxLines={liveMaxLines} permissionOpen={!!confirmation} /> : null}
        {!pickerOpen && status !== 'idle' && status !== 'awaiting_permission' ? (
          <Box marginTop={1}>
            <SpinnerLine status={status} startedAt={turnStartedAt} responseTokens={live?.text ? Math.round(live.text.length / 4) : 0} verbs={config.settings.spinnerVerbs} frame={frame} />
          </Box>
        ) : null}
        {notice && !pickerOpen ? (
          <Box paddingX={1} marginTop={1}>
            <Text color={notice.level === 'error' ? theme.error : notice.level === 'warn' ? theme.warning : theme.subtle}>{notice.text}</Text>
          </Box>
        ) : null}
        {showTodos && todos.length > 0 && todos.some((t) => t.status !== 'completed') && !confirmation && !pickerOpen ? (
          <TodoPanel todos={todos} frame={frame} maxItems={Math.max(3, Math.min(6, rows - 18))} />
        ) : null}
        {modelSwitch && !confirmation ? <QuotaDialog request={modelSwitch} /> : null}
        {confirmation ? <PermissionPrompt key={confirmation.toolCall.id} confirmation={confirmation} verbose={verbose} maxDiffLines={Math.max(8, rows - 14)} /> : null}
        {modelPickerOpen && !confirmation ? (
          <ModelPicker
            apiKey={config.apiKey}
            current={model}
            thinkingLevel={thinking}
            onCancel={() => { setModelPickerOpen(false); addSystem(`Kept model as ${modelLabel(model)}${(process.env.GEMINI_MODEL || config.settings.model || DEFAULT_MODEL) === model ? ' (default)' : ''}`, 'notice'); }}
            onSelect={(m, scope, thinkingLevel) => {
              setModelPickerOpen(false);
              let savedDefault = false;
              if (scope === 'default') {
                try {
                  saveDefaultModel(m.id, undefined, thinkingLevel);
                  config.settings.model = m.id;
                  config.settings.thinkingLevel = thinkingLevel;
                  savedDefault = true;
                } catch (err: any) {
                  addSystem(`Could not save the default model: ${err.message || String(err)}. Using it for this session.`, 'notice');
                }
              }
              agentRef.current?.switchModel(m.id, thinkingLevel);
              if (m.inputTokenLimit) agentRef.current?.setContextWindow(m.inputTokenLimit);
              setModel(m.id);
              config.thinkingLevel = thinkingLevel;
              setThinking(thinkingLevel);
              // Claude Code: "Set model to X (default) for this session only with low effort".
              addSystem(`Set model to ${colored('permission', modelLabel(m.id))}${savedDefault || (process.env.GEMINI_MODEL || config.settings.model || DEFAULT_MODEL) === m.id ? ' (default)' : ''}${scope === 'session' ? ' for this session only' : ''}${thinkingLevel ? ` with ${colored('permission', thinkingLevel)} effort` : ''}`, 'notice');
            }}
          />
        ) : null}
        {themePickerOpen && !confirmation ? (
          <ThemePicker
            current={themeName}
            syntaxHighlighting={themeBeforePicker.current?.syntaxHighlighting !== false}
            onPreview={(name, syntaxHighlighting) => setThemeState({ ...resolveTheme(name), syntaxHighlighting })}
            onCancel={() => { setThemePickerOpen(false); setThemeState(themeBeforePicker.current ?? loadTheme(themeName)); addSystem(`Kept theme as ${themeLabel(themeName)}`, 'notice'); }}
            onSelect={(name, syntaxHighlighting) => {
              setThemePickerOpen(false);
              try { saveTheme(name, syntaxHighlighting); } catch (err: any) { addSystem(`Could not save the theme: ${err.message || String(err)}. Using it for this session.`, 'notice'); }
              setThemeName(name);
              setThemeState({ ...resolveTheme(name), syntaxHighlighting });
              addSystem(`Theme set to ${themeLabel(name)}${syntaxHighlighting ? '' : ' · syntax highlighting off'}`, 'notice');
            }}
          />
        ) : null}
        {infoDialog && !confirmation ? (
          infoDialog.kind === 'effort' ? <EffortDialog levels={supportedThinkingLevels(model)} current={effectiveThinkingLevel(model, thinking) ?? supportedThinkingLevels(model)[0]} onSelect={(level, scope) => { setInfoDialog(null); applyEffort(level, scope); }} onCancel={() => { setInfoDialog(null); addSystem('Cancelled', 'notice'); }} ruleLabel={effortLabel} />
          : infoDialog.kind === 'btw' ? <BtwPanel question={infoDialog.question} ask={(q, onChunk, signal) => agentRef.current ? agentRef.current.askAside(q, onChunk, signal) : Promise.reject(new Error('No session'))} onCopy={(text) => { void copyToClipboard(text).catch(() => {}); }} onFork={(question) => { setInfoDialog(null); agentRef.current?.forkAside(question); }} onClose={() => setInfoDialog(null)} ruleLabel={effortLabel} />
          : infoDialog.kind === 'help' ? <HelpDialog commands={infoDialog.commands} custom={infoDialog.custom} onClose={() => setInfoDialog(null)} ruleLabel={effortLabel} />
          : infoDialog.kind === 'settings' ? <SettingsDialog status={infoDialog.status} usage={infoDialog.usage} config={infoDialog.config} stats={infoDialog.stats} initialTab={infoDialog.tab} onClose={() => setInfoDialog(null)} ruleLabel={effortLabel} />
          : infoDialog.kind === 'permissions' ? <PermissionsDialog allow={infoDialog.allow} ask={infoDialog.ask} deny={infoDialog.deny} denials={infoDialog.denials} autoRules={infoDialog.autoRules} disabledBuiltin={infoDialog.disabledBuiltin} onAddAutoRule={infoDialog.onAddAutoRule} onRemoveAutoRule={infoDialog.onRemoveAutoRule} onToggleBuiltin={infoDialog.onToggleBuiltin} directories={infoDialog.directories} onAddRule={infoDialog.onAddRule} onRemoveRule={infoDialog.onRemoveRule} onAddDirectory={infoDialog.onAddDirectory} onClose={() => setInfoDialog(null)} ruleLabel={effortLabel} />
          : infoDialog.kind === 'input' ? <InputDialog title={infoDialog.title} description={infoDialog.description} label={infoDialog.label} placeholder={infoDialog.placeholder} hint={infoDialog.hint} complete={infoDialog.complete} onSubmit={infoDialog.onSubmit} onClose={() => setInfoDialog(null)} ruleLabel={effortLabel} />
          : <ListDialog title={infoDialog.title} header={infoDialog.header} items={infoDialog.items} empty={infoDialog.empty} footer={infoDialog.footer} numbered={infoDialog.numbered} hint={infoDialog.hint} onClose={() => setInfoDialog(null)} ruleLabel={effortLabel} />
        ) : null}
        {resumeOpen && !confirmation ? (
          <SessionPicker
            sessions={listSessions(config.workspaceDir).filter((session) => session.id !== sessionId)}
            allSessions={() => listAllSessions().filter((session) => session.id !== sessionId)}
            onRename={(session, title) => { renameStoredSession(session.workspaceDir, session.id, title); }}
            onDelete={(session) => session.id !== sessionId && deleteSession(session.workspaceDir, session.id)}
            banner={bannerProps}
            branch={gitInfo?.isGit ? gitInfo.branch : undefined}
            ruleLabel={effortLabel}
            onCancel={() => setResumeOpen(false)}
            onSelect={(id, workspaceDir) => {
              setResumeOpen(false);
              if (path.resolve(workspaceDir) !== path.resolve(config.workspaceDir)) {
                addSystem(otherDirectoryNotice(id, workspaceDir), 'notice');
                return;
              }
              const session = loadSession(config.workspaceDir, id);
              if (!session) { addSystem(`Could not load session ${id}.`, 'notice'); return; }
              agentRef.current?.interrupt();
              setRestored(session);
              if (!fullscreen) clearScreen();
              setSessionEpoch((n) => n + 1);
            }}
          />
        ) : null}
        {rewindOpen && !confirmation ? (
          <RewindMenu
            checkpoints={agentRef.current?.getTurnCheckpoints() ?? []}
            codeChanges={(id) => agentRef.current?.turnCodeChanges(id) ?? []}
            onCancel={() => setRewindOpen(false)}
            onAction={(id, scope) => {
              setRewindOpen(false);
              if (scope === 'summarizeFrom' || scope === 'summarizeUpTo') {
                void agentRef.current?.summarizeTurn(id, scope === 'summarizeFrom' ? 'from' : 'upTo').catch((err: any) => addSystem(`✗ Summary failed: ${err.message}`, 'notice'));
                return;
              }
              try {
                const files = agentRef.current?.rewindTurn(id, scope) ?? [];
                addSystem(`↺ Rewound ${scope}${files.length ? ` · restored ${files.length} file${files.length === 1 ? '' : 's'}` : ''}.`);
              } catch (err: any) {
                addSystem(`✗ Rewind failed: ${err.message}`, 'notice');
              }
            }}
          />
        ) : null}
        <Box flexDirection="column" marginTop={promptMarginTop} display={hideInput ? 'none' : 'flex'}>
          {inputState.menuOpen || inputState.searching ? null : <PromptHints model={model} thinkingLevel={thinking} multiline={inputState.multiline} killed={inputState.killed} stashed={inputState.stashed} editor={editor} />}
          <InputBox
            isActive={!modalOpen}
            busy={status !== 'idle'}
            queue={queue}
            history={history}
            allHistory={allHistory}
            sessionHistory={restored?.messages.filter((message) => message.role === 'user').map((message) => message.content)}
            fullscreen={fullscreen}
            cwd={config.workspaceDir}
            commands={menuCommands}
            showHelp={showHelp}
            placeholder={suggestion}
            onSubmit={onSubmit}
            onSendNow={onSendNow}
            onBackground={() => agentRef.current?.backgroundCurrentBash() ?? false}
            onTakeQueue={(empty) => agentRef.current?.takeQueue(empty)}
            onCommand={onCommand}
            onBash={onBash}
            onInterrupt={onInterrupt}
            onExit={() => void handleExit()}
            onCycleMode={cycleMode}
            onClearScreen={clearScreen}
            onToggleVerbose={() => setViewer((v) => (v === 'transcript' ? null : 'transcript'))}
            onToggleHelp={onToggleHelp}
            onToggleTodos={onToggleTodos}
            onOpenDiff={openDiffViewer}
            onCycleDiffBase={cycleDiffBase}
            onScrollTranscript={fullscreen ? (direction, x) => {
              // The wheel over the diff panel scrolls the panel.
              if (diffPanel && x !== undefined && x - 1 >= diffPanelLayout(stdout?.columns ?? 80).left && (direction === 'lineUp' || direction === 'lineDown')) {
                scrollDiffPanel(direction === 'lineUp' ? -3 : 3);
                return;
              }
              setScrollRequest((value) => ({ id: value.id + 1, direction }));
            } : undefined}
            onDoubleEscape={onDoubleEscape}
            onPopQueue={onPopQueue}
            onStateChange={onInputState}
            onSwitchModel={() => setModelPickerOpen(true)}
            onSuspend={onSuspend}
            onAgents={() => setAgentsOpen(true)}
            onMouseRelease={diffPanel ? onPanelRelease : undefined}
            injected={injected}
            onMouseClick={diffPanel ? (x, y) => {
              const { left, panel } = diffPanelLayout(stdout?.columns ?? 80);
              const col = x - 1 - left;
              if (col < 0) return;
              const action = diffPanelClick(diffPanel, panel, measuredTranscriptHeight ?? transcriptHeight, y - 1, col);
              // A press on a diff line may start a selection, ended by the release (onPanelRelease).
              if (!action) { pressRow.current = y - 1; return; }
              if ('close' in action) { setDiffPanel(null); setDiffPreference('closed'); addSystem('Diff panel hidden', 'notice'); }
              else if ('toggle' in action) setDiffPanel(loadDiffPanel(!diffPanel.showOthers, 0, diffPanel.showSkipped, diffPanel.base) ?? diffPanel);
              else if ('toggleSkipped' in action) setDiffPanel({ ...diffPanel, showSkipped: !diffPanel.showSkipped });
              else setDiffPanel({ ...diffPanel, scroll: action.scroll });
            } : undefined}
            commandUsage={commandUsage}
          />
          {inputState.searching ? null : showHelp ? <ShortcutsHelp /> : <Footer
            mode={mode}
            status={status}
            usage={usage}
            autoCompactThreshold={config.autoCompactThreshold}
            inputEmpty={inputState.empty}
            bashMode={inputState.bashMode}
            menuOpen={inputState.menuOpen}
            hint={inputState.hint}
            statusLine={statusLine}
            statusLinePadding={config.settings.statusLine?.padding}
            backgroundTasks={backgroundRunning}
            quota={quota}
          />}
        </Box>
        </Box>
        </Box>
      </Box>
    </ThemeProvider>
    </TerminalInputEnabled.Provider>
  );
};
