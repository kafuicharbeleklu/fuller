import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { marked, type Token, type Tokens } from 'marked';
import { highlight, supportsLanguage } from 'cli-highlight';
import stringWidth from 'string-width';
import { useTheme, type Theme } from './theme.js';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+|#39);/gi, (m, e: string) => {
  if (e.startsWith('#x') || e.startsWith('#X')) return String.fromCodePoint(parseInt(e.slice(2), 16));
  if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()] ?? m;
});

const highlightCache = new Map<string, string>();

export function highlightCode(code: string, lang?: string): string {
  const key = `${lang ?? ''}\u0000${code}`;
  const cached = highlightCache.get(key);
  if (cached) return cached;
  let out = code;
  try {
    const language = lang && supportsLanguage(lang) ? lang : undefined;
    out = highlight(code, { language, ignoreIllegals: true });
  } catch {
    out = code;
  }
  if (highlightCache.size > 200) highlightCache.clear();
  highlightCache.set(key, out);
  return out;
}

function renderInline(tokens: Token[] | undefined, theme: Theme, keyPrefix = ''): React.ReactNode[] {
  if (!tokens) return [];
  return tokens.map((t, i) => {
    const key = `${keyPrefix}${i}`;
    switch (t.type) {
      case 'text': {
        const tk = t as Tokens.Text;
        if (tk.tokens && tk.tokens.length) return <Text key={key}>{renderInline(tk.tokens, theme, key + '-')}</Text>;
        return <Text key={key}>{decode(tk.text)}</Text>;
      }
      case 'escape':
        return <Text key={key}>{decode((t as Tokens.Escape).text)}</Text>;
      case 'strong':
        return <Text key={key} bold>{renderInline((t as Tokens.Strong).tokens, theme, key + '-')}</Text>;
      case 'em':
        return <Text key={key} italic>{renderInline((t as Tokens.Em).tokens, theme, key + '-')}</Text>;
      case 'del':
        return <Text key={key} strikethrough>{renderInline((t as Tokens.Del).tokens, theme, key + '-')}</Text>;
      case 'codespan':
        return <Text key={key} color={theme.code}>{decode((t as Tokens.Codespan).text)}</Text>;
      case 'link': {
        const l = t as Tokens.Link;
        const label = renderInline(l.tokens, theme, key + '-');
        const showHref = l.text !== l.href;
        return (
          <Text key={key}>
            <Text color={theme.link} underline>{label}</Text>
            {showHref ? <Text color={theme.subtle}> ({l.href})</Text> : null}
          </Text>
        );
      }
      case 'image':
        return <Text key={key} color={theme.subtle}>[image: {(t as Tokens.Image).text || (t as Tokens.Image).href}]</Text>;
      case 'br':
        return <Text key={key}>{'\n'}</Text>;
      case 'html':
        return <Text key={key}>{(t as Tokens.HTML).text}</Text>;
      default:
        return <Text key={key}>{(t as any).raw ?? ''}</Text>;
    }
  });
}

function listMarker(ordered: boolean, index: number, start: number, depth: number): string {
  // Claude Code 2.1.281 draws unordered items with "-".
  if (!ordered) return '-';
  const n = start + index;
  if (depth === 1) return String.fromCharCode(96 + ((n - 1) % 26) + 1) + '.';
  return `${n}.`;
}

function renderTable(t: Tokens.Table, theme: Theme, width: number, key: string): React.ReactNode {
  const cellText = (cell: Tokens.TableCell) => decode(cell.tokens.map((x: any) => x.text ?? x.raw ?? '').join(''));
  const header = t.header.map(cellText);
  const rows = t.rows.map((r) => r.map(cellText));
  const cols = header.length;
  const maxCol = Math.max(3, Math.floor((width - 1 - 3 * cols) / Math.max(1, cols)));
  const widths = header.map((h, c) => Math.min(maxCol, Math.max(stringWidth(h), ...rows.map((r) => stringWidth(r[c] ?? '')))));
  const fit = (s: string, w: number) => {
    let out = s;
    while (stringWidth(out) > w) out = out.slice(0, -1);
    return out + ' '.repeat(Math.max(0, w - stringWidth(out)));
  };
  // Claude Code draws tables with box-drawing borders and a rule between rows.
  const border = (left: string, mid: string, right: string) => left + widths.map((w) => '─'.repeat(w + 2)).join(mid) + right;
  const line = (cells: string[]) => '│' + cells.map((c, i) => ` ${fit(c ?? '', widths[i])} `).join('│') + '│';
  return (
    <Box key={key} flexDirection="column" marginY={0}>
      <Text>{border('┌', '┬', '┐')}</Text>
      <Text>{line(header)}</Text>
      {rows.map((r, i) => (
        <React.Fragment key={i}>
          <Text>{border('├', '┼', '┤')}</Text>
          <Text>{line(r)}</Text>
        </React.Fragment>
      ))}
      <Text>{border('└', '┴', '┘')}</Text>
    </Box>
  );
}

function renderBlocks(tokens: Token[], theme: Theme, width: number, depth = 0, keyPrefix = ''): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  tokens.forEach((t, i) => {
    const key = `${keyPrefix}${i}`;
    switch (t.type) {
      case 'space':
        break;
      case 'heading': {
        const h = t as Tokens.Heading;
        out.push(
          <Box key={key} marginTop={out.length ? 1 : 0}>
            <Text bold underline={h.depth <= 1}>{renderInline(h.tokens, theme, key + '-')}</Text>
          </Box>
        );
        break;
      }
      case 'paragraph':
        out.push(<Box key={key} marginTop={out.length ? 1 : 0}><Text>{renderInline((t as Tokens.Paragraph).tokens, theme, key + '-')}</Text></Box>);
        break;
      case 'text': {
        const tk = t as Tokens.Text;
        out.push(<Box key={key}><Text>{tk.tokens ? renderInline(tk.tokens, theme, key + '-') : decode(tk.text)}</Text></Box>);
        break;
      }
      case 'code': {
        const c = t as Tokens.Code;
        const lines = (theme.syntaxHighlighting === false ? c.text : highlightCode(c.text, c.lang)).split('\n');
        out.push(
          <Box key={key} flexDirection="column" marginTop={out.length ? 1 : 0}>
            {lines.map((l, li) => <Text key={li}>{l || ' '}</Text>)}
          </Box>
        );
        break;
      }
      case 'blockquote': {
        const inner = renderBlocks((t as Tokens.Blockquote).tokens, theme, width - 2, depth, key + '-');
        out.push(
          <Box key={key} marginTop={out.length ? 1 : 0}>
            <Text color={theme.subtle}>▎ </Text>
            <Box flexDirection="column" flexGrow={1}>{inner}</Box>
          </Box>
        );
        break;
      }
      case 'list': {
        const l = t as Tokens.List;
        const start = typeof l.start === 'number' ? l.start : 1;
        out.push(
          <Box key={key} flexDirection="column" marginTop={out.length && depth === 0 ? 1 : 0}>
            {l.items.map((item, ii) => {
              const marker = item.task ? (item.checked ? '☑' : '☐') : listMarker(l.ordered, ii, start, depth);
              return (
                <Box key={ii} flexDirection="row">
                  <Box width={marker.length + 1} flexShrink={0}><Text>{marker} </Text></Box>
                  <Box flexDirection="column" flexGrow={1}>{renderBlocks(item.tokens, theme, width - marker.length - 1, depth + 1, `${key}-${ii}-`)}</Box>
                </Box>
              );
            })}
          </Box>
        );
        break;
      }
      case 'table':
        out.push(<Box key={key} marginTop={out.length ? 1 : 0}>{renderTable(t as Tokens.Table, theme, width, key + '-t')}</Box>);
        break;
      case 'hr':
        out.push(<Text key={key} color={theme.subtle}>{'─'.repeat(Math.max(10, Math.min(width, 60)))}</Text>);
        break;
      case 'html':
        out.push(<Text key={key}>{(t as Tokens.HTML).text}</Text>);
        break;
      default:
        out.push(<Text key={key}>{(t as any).raw ?? ''}</Text>);
    }
  });
  return out;
}

export const Markdown: React.FC<{ content: string; width?: number }> = React.memo(({ content, width }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const w = width ?? Math.max(20, (stdout?.columns ?? 80) - 4);
  if (!content) return null;
  let tokens: Token[];
  try {
    tokens = marked.lexer(content, { gfm: true, breaks: false });
  } catch {
    return <Text>{content}</Text>;
  }
  return <Box flexDirection="column">{renderBlocks(tokens, theme, w)}</Box>;
});
Markdown.displayName = 'Markdown';
