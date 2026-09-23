import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';
import { Markdown } from './Markdown.js';
import { ToolRow } from './ToolRow.js';
import { Banner, type BannerProps } from './Banner.js';
import type { TranscriptItem } from '../agent/types.js';
import { BULLET, BULLET_GAP } from './glyphs.js';

interface Props {
  item: TranscriptItem;
  verbose: boolean;
  banner: BannerProps;
}

export const TranscriptItemView: React.FC<Props> = React.memo(({ item, verbose, banner }) => {
  const theme = useTheme();
  switch (item.kind) {
    case 'banner':
      return <Banner {...banner} />;

    case 'user': {
      const m = item.message;
      if (m.kind === 'bash') {
        return (
          <Box marginTop={1}>
            <Text color={theme.bashBorder} bold>! </Text>
            <Text color={theme.bashBorder}>{m.content}</Text>
          </Box>
        );
      }
      const lines = m.content.split('\n');
      return (
        <Box flexDirection="column" marginTop={1}>
          {lines.map((l, i) => (
            <Box key={i}>
              <Text color={theme.subtle} bold>{i === 0 ? '❯ ' : '  '}</Text>
              <Text color={m.kind === 'command' ? theme.subtle : theme.user} bold={m.kind !== 'command'}>{l || ' '}</Text>
            </Box>
          ))}
          {m.attachments?.map((a, i) => (
            <Box key={`att-${i}`}>
              <Text color={theme.subtle}>  🖼 [Image #{i + 1}] {a.name} · {Math.round(a.bytes / 1024)} KB</Text>
            </Box>
          ))}
        </Box>
      );
    }

    case 'text':
      return (
        <Box marginTop={1}>
          <Text color={theme.accent}>{BULLET}{BULLET_GAP}</Text>
          <Box flexDirection="column" flexGrow={1}>
            <Markdown content={item.content} />
          </Box>
        </Box>
      );

    case 'tool':
      return (
        <Box marginTop={1}>
          <ToolRow toolCall={item.toolCall} verbose={verbose} />
        </Box>
      );

    case 'system': {
      const m = item.message;
      if (m.kind === 'compact') {
        const lines = m.content.split('\n');
        const shown = verbose ? lines : lines.slice(0, 8);
        return (
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.accent}>✻ Conversation compacted</Text>
            <Box flexDirection="column" marginLeft={2}>
              {shown.map((l, i) => <Text key={i} color={theme.subtle} wrap="truncate-end">{l || ' '}</Text>)}
              {lines.length > shown.length ? <Text color={theme.subtle}>… +{lines.length - shown.length} lines (ctrl+o to expand)</Text> : null}
            </Box>
          </Box>
        );
      }
      if (m.kind === 'notice') {
        const isError = m.content.startsWith('✗');
        return (
          <Box marginTop={1} marginLeft={2}>
            <Text color={isError ? theme.error : theme.warning}>⎿  {m.content}</Text>
          </Box>
        );
      }
      return (
        <Box marginTop={1}>
          <Text color={theme.subtle}>{BULLET}{BULLET_GAP}</Text>
          <Box flexDirection="column" flexGrow={1}>
            <Markdown content={m.content} />
          </Box>
        </Box>
      );
    }

    case 'turn_end': {
      if (item.durationMs < 3000 && item.toolCount === 0) return null;
      const secs = Math.round(item.durationMs / 1000);
      const dur = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
      return (
        <Box marginTop={0}>
          <Text color={theme.subtle}>
            ✻ Worked for {dur}{item.toolCount ? ` · ${item.toolCount} tool use${item.toolCount === 1 ? '' : 's'}` : ''}
          </Text>
        </Box>
      );
    }
    default:
      return null;
  }
});
TranscriptItemView.displayName = 'TranscriptItemView';
