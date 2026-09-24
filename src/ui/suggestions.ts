import type { TranscriptItem } from '../agent/types.js';

export interface SuggestionContext {
  items?: TranscriptItem[];
  isGit?: boolean;
  gitDirty?: boolean;
}

/** Example prompts shown dimmed in an empty input before the first message, as Claude Code does. */
export const EXAMPLE_PROMPTS = [
  'fix lint errors',
  'fix typecheck errors',
  'edit <filepath> to...',
  'how does <filepath> work?',
  'write a test for <filepath>',
  'refactor <filepath> to...',
  'create a util logging.py that...',
];

// One example per session, so the placeholder does not change between renders.
const sessionExample = EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)];

/**
 * Computes the dimmed placeholder of the input prompt (Claude Code style): an
 * example before the first message, then a suggestion only when the last tool
 * call gives specific context (e.g. failing test or typecheck).
 */
export function getPromptSuggestion(context: SuggestionContext = {}, example = sessionExample): string {
  const { items = [] } = context;

  if (items.length <= 1) {
    return `Try "${example}"`;
  }

  // Inspect the last tool execution for actionable context
  const lastToolItem = [...items].reverse().find((item) => item.kind === 'tool' && item.toolCall);
  if (lastToolItem && lastToolItem.kind === 'tool') {
    const call = lastToolItem.toolCall;
    const text = ((call.result ?? '') + ' ' + (call.error ?? '')).toLowerCase();

    if (call.status === 'failed' || call.error || text.includes('error') || text.includes('failed')) {
      if (text.includes('type') || /ts\d+/.test(text) || text.includes('tsc') || text.includes('typecheck')) {
        return 'Try "fix typecheck errors"';
      }
      if (text.includes('test') || text.includes('vitest') || text.includes('jest') || text.includes('assertion')) {
        return 'Try "fix the failing test"';
      }
      return 'Try "fix the error above"';
    }
  }

  return '';
}
