import React from 'react';
import { Box, Text, useStdout } from 'ink';
import stringWidth from 'string-width';
import { turnEndLine } from './viewerText.js';
import { ContextView, type ContextData } from './ContextView.js';
import { useTheme, type Theme } from './theme.js';
import { parseSegments } from './segments.js';
import { Markdown } from './Markdown.js';
import { ToolRow } from './ToolRow.js';
import { Banner, type BannerProps } from './Banner.js';
import type { TranscriptItem } from '../agent/types.js';
import { BULLET, BULLET_GAP, TEXT_BULLET } from './glyphs.js';

interface Props {
  item: TranscriptItem;
  verbose: boolean;
  banner: BannerProps;
}

/** A system message's `{{colour:text}}` pieces in their theme colours. */
function renderSegments(content: string, theme: Theme): React.ReactNode {
  const segments = parseSegments(content);
  if (segments.length === 1 && !segments[0].color) return content;
  return segments.map((seg, i) => (seg.color
    ? <Text key={i} color={(theme as unknown as Record<string, string>)[seg.color] ?? seg.color}>{seg.text}</Text>
    : <React.Fragment key={i}>{seg.text}</React.Fragment>));
}

export function wrapUserLines(content: string, width: number): { prefix: string; text: string; pad: number }[] {
  const logical = content.replace(/\t/g, '   ').split('\n');
  const rows: { prefix: string; text: string; pad: number }[] = [];
  // Claude Code: "❯ " at column 0, continuation lines indented by two, background to the edge.
  const maxContent = Math.max(10, width - 2);

  for (let li = 0; li < logical.length; li++) {
    const line = logical[li];
    if (!line) {
      const prefix = li === 0 && rows.length === 0 ? '❯ ' : '  ';
      rows.push({ prefix, text: '', pad: Math.max(0, width - 2) });
      continue;
    }
    const words = line.split(' ');
    let cur = '';
    for (const w of words) {
      if (!cur) {
        cur = w;
      } else if (stringWidth(cur + ' ' + w) <= maxContent) {
        cur += ' ' + w;
      } else {
        const prefix = rows.length === 0 ? '❯ ' : '  ';
        rows.push({ prefix, text: cur, pad: Math.max(0, width - 2 - stringWidth(cur)) });
        cur = w;
      }
    }
    if (cur) {
      while (stringWidth(cur) > maxContent) {
        let cut = 0;
        let cutWidth = 0;
        for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(cur)) {
          const sw = stringWidth(segment);
          if (cutWidth + sw > maxContent) break;
          cut += segment.length;
          cutWidth += sw;
        }
        if (cut === 0) cut = 1;
        const part = cur.slice(0, cut);
        cur = cur.slice(cut);
        const prefix = rows.length === 0 ? '❯ ' : '  ';
        rows.push({ prefix, text: part, pad: Math.max(0, width - 2 - stringWidth(part)) });
      }
      const prefix = rows.length === 0 ? '❯ ' : '  ';
      rows.push({ prefix, text: cur, pad: Math.max(0, width - 2 - stringWidth(cur)) });
    }
  }
  return rows;
}

export const TranscriptItemView: React.FC<Props> = React.memo(({ item, verbose, banner }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const columns = Math.max(20, stdout?.columns ?? 80);

  switch (item.kind) {
    case 'banner':
      return <Banner {...banner} />;

    case 'user': {
      const m = item.message;
      if (m.kind === 'bash') {
        // Claude Code: "! command" on a dark background across the width, the "!" in the shell colour.
        const rows = wrapUserLines(m.content, columns);
        return (
          <Box flexDirection="column" marginTop={1}>
            {rows.map((row, i) => (
              <Text key={i} backgroundColor={theme.bashBg}>
                <Text color={theme.bashBorder}>{i === 0 ? '! ' : '  '}</Text>
                <Text color={theme.user}>{row.text}</Text>
                <Text>{' '.repeat(row.pad)}</Text>
              </Text>
            ))}
          </Box>
        );
      }
      const userRows = wrapUserLines(m.content, columns);
      return (
        <Box flexDirection="column" marginTop={1}>
          {userRows.map((row, i) => (
            <Box key={i}>
              <Text backgroundColor={theme.userBg}>
                <Text color={theme.userPrompt ?? theme.subtle}>{row.prefix}</Text>
                <Text color={theme.user}>{row.text}</Text>
                <Text>{' '.repeat(row.pad)}</Text>
              </Text>
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
          <Text color={theme.text}>{TEXT_BULLET} </Text>
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
      if (m.kind === 'warning') {
        // Claude Code: "● Unknown command: /foo" in the warning colour.
        return <Box marginTop={1}><Text color={theme.warning}>{TEXT_BULLET} {m.content}</Text></Box>;
      }
      if (m.kind === 'event') {
        // Claude Code: "● Agent "…" finished · 2s", the bullet coloured by the outcome.
        return <Box marginTop={1}><Text>{renderSegments(m.content, theme)}</Text></Box>;
      }
      if (m.kind === 'context') {
        try { return <Box marginTop={0}><ContextView data={JSON.parse(m.content) as ContextData} /></Box>; } catch { /* fall through */ }
      }
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
        // Errors are marked "✗" internally; Claude Code shows them in red without the mark.
        const shown = isError ? m.content.replace(/^✗\s*/, '') : m.content;
        return (
          <Box marginTop={0} marginLeft={2}>
            <Text color={isError ? theme.error : m.content.startsWith('⚠') ? theme.warning : theme.subtle}>⎿  {renderSegments(shown, theme)}</Text>
          </Box>
        );
      }
      return (
        // Claude Code shows a command's output under it: "  ⎿  " and the text.
        <Box marginTop={0} marginLeft={2}>
          <Text color={theme.subtle}>⎿  </Text>
          <Box flexDirection="column" flexGrow={1}>
            <Markdown content={m.content} />
          </Box>
        </Box>
      );
    }

    case 'turn_end': {
      const line = turnEndLine(item);
      return line ? <Box marginTop={1}><Text color={theme.subtle}>{line}</Text></Box> : null;
    }
    default:
      return null;
  }
});
TranscriptItemView.displayName = 'TranscriptItemView';
