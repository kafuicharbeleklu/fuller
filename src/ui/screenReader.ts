import readline from 'node:readline/promises';
import fs from 'node:fs';
import stripAnsi from 'strip-ansi';
import { AgentLoop, type AgentCallbacks } from '../agent/loop.js';
import type { AppConfig } from '../config.js';
import { listSessions, loadSession, type SessionData } from '../session/store.js';
import type { PendingConfirmation, TranscriptItem } from '../agent/types.js';
import { readGitDiff } from './gitDiff.js';

const MAX_ANNOUNCED_OUTPUT = 10 * 1024 * 1024;

function say(label: string, text: string) {
  process.stdout.write(`${label}: ${stripAnsi(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')}\n`);
}

function announce(item: TranscriptItem) {
  if (item.kind === 'user') return;
  if (item.kind === 'text') say('fuller', item.content);
  else if (item.kind === 'system') say(item.message.content.startsWith('✗') ? 'error' : 'notice', item.message.content);
  else if (item.kind === 'tool') {
    say(item.toolCall.status === 'failed' ? 'tool error' : 'tool', `${item.toolCall.name}(${JSON.stringify(item.toolCall.args)})`);
    let result = item.toolCall.result || item.toolCall.error || item.toolCall.summary || '';
    if (item.toolCall.outputFile && fs.existsSync(item.toolCall.outputFile)) {
      const size = fs.statSync(item.toolCall.outputFile).size;
      result = size <= MAX_ANNOUNCED_OUTPUT ? fs.readFileSync(item.toolCall.outputFile, 'utf8')
        : `Full output: ${item.toolCall.outputFile} (${size} bytes).`;
    }
    if (result) say('result', result);
  }
}

/** Plain, append-only interactive mode for terminal screen readers. */
export async function runScreenReader(config: AppConfig, initialPrompt?: string, restored?: SessionData, pickSession = false): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write('[Screen Reader Mode: on. Commands: /help, /diff, /rewind, /clear, /exit]\n');
  if (pickSession) {
    const sessions = listSessions(config.workspaceDir);
    sessions.forEach((session, index) => say('session', `${index + 1}. ${session.title} (${new Date(session.updatedAt).toLocaleString()})`));
    if (sessions.length) {
      const answer = Number((await rl.question(`Choose session (1-${sessions.length}, Enter for new): `)).trim());
      if (Number.isInteger(answer) && answer >= 1 && answer <= sessions.length) restored = loadSession(config.workspaceDir, sessions[answer - 1].id) ?? undefined;
    } else say('notice', 'No previous sessions. Starting a new one.');
  }
  let agent: AgentLoop;
  const askPermission = async (confirmation: PendingConfirmation) => {
    say('Permission Required', confirmation.title);
    confirmation.options.forEach((option, index) => say('option', `${index + 1}. ${option.label}`));
    while (true) {
      const answer = (await rl.question(`Enter selection (1-${confirmation.options.length}, or n): `)).trim().toLowerCase();
      if (answer === 'n') { confirmation.onDecide({ kind: 'no' }); return; }
      const option = confirmation.options[Number(answer) - 1];
      if (!option) { say('warning', 'Choose one of the numbered options.'); continue; }
      if (option.value === 'yes') confirmation.onDecide({ kind: 'yes' });
      else if (option.value === 'always') confirmation.onDecide({ kind: 'always', rule: option.rule ?? '', ...(option.rules ? { rules: option.rules } : {}) });
      else confirmation.onDecide({ kind: 'no', feedback: (await rl.question('Tell Fuller what to do instead (optional): ')).trim() || undefined });
      return;
    }
  };
  const callbacks: AgentCallbacks = {
    onStatusChange: () => {},
    onCommit: announce,
    onLive: () => {},
    onRequestConfirmation: (confirmation) => { if (confirmation) void askPermission(confirmation); },
    onUsage: () => {},
    onNotice: (notice) => { if (notice) say(notice.level, notice.text); },
    onQueueChange: () => {},
    onTranscriptReset: () => say('notice', 'Conversation restored to the selected checkpoint.'),
  };
  agent = new AgentLoop(config, callbacks, restored);
  if (restored) restored.messages.forEach((message) => {
    if (message.role === 'user') say('you', message.content);
    else if (message.role === 'system') say('notice', message.content);
    else say('fuller', message.content);
  });
  const onSigint = () => { agent.interrupt(); say('notice', 'Interrupted.'); };
  process.on('SIGINT', onSigint);
  try {
    if (initialPrompt) { say('you', initialPrompt); await agent.handleUserInput(initialPrompt); }
    while (true) {
      const input = (await rl.question('you: ')).trim();
      if (input === '/exit' || input === '/quit') break;
      if (input === '/help') { say('help', 'Enter a prompt or use /diff, /rewind, /clear, /exit. Permissions use numbered choices.'); continue; }
      if (input === '/clear') { agent.clearHistory(); say('notice', 'New conversation.'); continue; }
      if (input === '/diff') { readGitDiff(config.workspaceDir).forEach((line) => say('diff', line)); continue; }
      if (input === '/rewind') {
        const checkpoints = agent.getTurnCheckpoints().slice(0, 20);
        if (!checkpoints.length) { say('notice', 'No conversation checkpoints.'); continue; }
        checkpoints.forEach((checkpoint, index) => say('checkpoint', `${index + 1}. ${checkpoint.prompt.split('\n')[0].slice(0, 70)}`));
        const number = Number((await rl.question(`Choose checkpoint (1-${checkpoints.length}, Enter to cancel): `)).trim());
        if (!Number.isInteger(number) || number < 1 || number > checkpoints.length) continue;
        const scope = (await rl.question('Restore (b)oth, (c)onversation, or c(o)de? ')).trim().toLowerCase();
        const choice = scope === 'b' ? 'both' : scope === 'c' ? 'conversation' : scope === 'o' ? 'code' : null;
        if (!choice) { say('notice', 'Rewind cancelled.'); continue; }
        try { say('notice', `Rewound ${choice}; restored ${agent.rewindTurn(checkpoints[number - 1].id, choice).length} files.`); }
        catch (error: any) { say('error', error.message || String(error)); }
        continue;
      }
      if (!input) continue;
      await agent.handleUserInput(input);
    }
  } finally {
    process.off('SIGINT', onSigint);
    rl.close();
    await agent.flush();
  }
}
