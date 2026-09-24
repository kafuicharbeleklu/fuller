import React from 'react';
import { Box, Text, useStdout } from 'ink';
import wrapAnsi from 'wrap-ansi';
import { useTheme } from './theme.js';
import { formatRelative } from '../session/store.js';

export type SearchScope = 'session' | 'project' | 'all';

/** Claude Code's scope names: "everywhere" for all history. */
export const SCOPE_LABEL: Record<SearchScope, string> = { all: 'everywhere', project: 'project', session: 'session' };
/** ctrl+s order, starting from Claude Code's default. */
export const NEXT_SCOPE: Record<SearchScope, SearchScope> = { all: 'session', session: 'project', project: 'all' };

const LIST_ROWS = 8;

interface Props {
  query: string;
  scope: SearchScope;
  matches: string[];
  index: number;
  /** When a prompt was last sent, shown as "11m ago" before it. */
  timeOf?: (entry: string) => number | undefined;
}

/**
 * ctrl+r in fullscreen, laid out like Claude Code 2.1.281: "Search prompts ·
 * everywhere", the matches with the selection at the bottom and older prompts
 * above, a framed preview on the right, the framed filter field and the keys.
 */
export const HistorySearch: React.FC<Props> = ({ query, scope, matches, index, timeOf }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = Math.max(40, stdout.columns || 80);
  const listWidth = Math.floor((width - 2) * 0.52);
  const previewWidth = Math.max(10, width - 2 - listWidth - 1);
  const shown = matches.slice(index, index + LIST_ROWS).reverse();
  const olderHidden = matches.length > index + LIST_ROWS;
  const selected = matches[index] ?? '';
  const age = (entry: string) => { const ts = timeOf?.(entry); return ts ? formatRelative(ts) : ''; };
  const preview = wrapAnsi(selected.replace(/\s+/g, ' '), previewWidth - 4, { hard: true }).split('\n').slice(0, LIST_ROWS - 2);

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text bold color={theme.permission}>Search prompts · {SCOPE_LABEL[scope]}</Text>
      <Box flexDirection="row">
        <Box flexDirection="column" width={listWidth}>
          {matches.length === 0 ? <Text color={theme.subtle}>No matching prompts</Text> : null}
          {shown.map((entry, i) => {
            const isSelected = i === shown.length - 1;
            const marker = isSelected ? '❯ ' : i === 0 && olderHidden ? '↑ ' : '  ';
            return (
              <Text key={`${index}-${i}`} wrap="truncate-end">
                <Text color={isSelected ? theme.permission : theme.subtle}>{marker}</Text>
                {age(entry) ? <Text color={theme.subtle}>{age(entry)}  </Text> : null}
                <Text color={isSelected ? theme.permission : undefined}>{entry.replace(/\s+/g, ' ')}</Text>
              </Text>
            );
          })}
        </Box>
        {selected ? (
          <Box flexDirection="column" width={previewWidth} height={Math.max(3, shown.length)} borderStyle="round" borderDimColor paddingX={1}>
            {preview.map((line, i) => <Text key={i} color={theme.subtle}>{line || ' '}</Text>)}
          </Box>
        ) : null}
      </Box>
      <Box borderStyle="round" borderColor={theme.permission} width={width - 4} paddingX={1}>
        <Text>⌕ {query ? query : <Text color={theme.subtle}>Filter history…</Text>}</Text>
      </Box>
      <Text color={theme.subtle}>↑/↓ to nav · Enter to use · Esc to cancel · ctrl+s to scope</Text>
    </Box>
  );
};
