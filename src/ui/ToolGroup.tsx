import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import type { ToolCallState, TranscriptItem } from '../agent/types.js';

/** Consecutive finished exploration tools, shown as one line in the normal (non-verbose) view. */
export interface ToolGroupItem {
  key: string;
  kind: 'tool_group';
  tools: ToolCallState[];
}

export type DisplayItem = TranscriptItem | ToolGroupItem;

const COLLAPSIBLE = new Set(['read_file', 'outline_file', 'list_directory', 'search_files', 'glob', 'execute_bash', 'web_fetch']);
const LISTING = /^\s*(?:ls|tree|find)(?:\s|$)/;

/**
 * Claude Code 2.1.281 folds successful read-only tool calls that follow each
 * other into "Read 1 file, listed 1 directory, ran 1 shell command"; ctrl+o
 * shows them one by one. Edits, failures and rejections stay visible.
 */
export function groupToolItems(items: TranscriptItem[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  let run: ToolCallState[] = [];
  let runKey = '';
  const flush = () => {
    if (run.length) out.push({ key: `group-${runKey}-${run.length}`, kind: 'tool_group', tools: run });
    run = [];
  };
  for (const item of items) {
    // A command the user ran with "!" always shows its output; only the model's calls are folded.
    const userShell = item.kind === 'tool' && item.toolCall.origin === 'user';
    if (!userShell && item.kind === 'tool' && item.toolCall.status === 'completed' && COLLAPSIBLE.has(item.toolCall.name)) {
      if (!run.length) runKey = item.key;
      run.push(item.toolCall);
      continue;
    }
    flush();
    out.push(item);
  }
  flush();
  return out;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** The parts of the summary line, e.g. [["Read", 1, "file"], ["listed", 1, "directory"]]. */
export function toolGroupParts(tools: ToolCallState[]): Array<[string, number, string]> {
  const count = (test: (tool: ToolCallState) => boolean) => tools.filter(test).length;
  const reads = count((tool) => tool.name === 'read_file' || tool.name === 'outline_file');
  const listings = count((tool) => tool.name === 'list_directory' || (tool.name === 'execute_bash' && LISTING.test(String(tool.args.command ?? ''))));
  const searches = count((tool) => tool.name === 'search_files' || tool.name === 'glob');
  const shells = count((tool) => tool.name === 'execute_bash');
  const fetches = count((tool) => tool.name === 'web_fetch');
  const parts: Array<[string, number, string]> = [];
  if (reads) parts.push(['read', reads, plural(reads, 'file', 'files')]);
  if (listings) parts.push(['listed', listings, plural(listings, 'directory', 'directories')]);
  if (searches) parts.push(['searched for', searches, plural(searches, 'pattern', 'patterns')]);
  if (shells) parts.push(['ran', shells, plural(shells, 'shell command', 'shell commands')]);
  if (fetches) parts.push(['fetched', fetches, plural(fetches, 'page', 'pages')]);
  if (parts.length) parts[0][0] = parts[0][0][0].toUpperCase() + parts[0][0].slice(1);
  return parts;
}

export const ToolGroupRow: React.FC<{ tools: ToolCallState[] }> = ({ tools }) => {
  const theme = useTheme();
  const parts = toolGroupParts(tools);
  return (
    <Box marginTop={1} paddingLeft={2}>
      <Text color={theme.subtle}>
        {parts.map(([verb, n, noun], i) => (
          <React.Fragment key={i}>{i ? ', ' : ''}{verb} <Text bold>{n}</Text> {noun}</React.Fragment>
        ))}
      </Text>
    </Box>
  );
};
