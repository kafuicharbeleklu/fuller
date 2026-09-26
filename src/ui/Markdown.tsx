import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { marked, type Token, type Tokens } from 'marked';
import { highlight, supportsLanguage } from 'cli-highlight';
import chalk from 'chalk';
import stringWidth from 'string-width';
import { useTheme, type Theme } from './theme.js';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+|#39);/gi, (m, e: string) => {
  if (e.startsWith('#x') || e.startsWith('#X')) return String.fromCodePoint(parseInt(e.slice(2), 16));
  if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()] ?? m;
});

const highlightCache = new Map<string, string>();

/** Words Monokai colours as storage (cyan), other keywords being control flow (pink). */
const STORAGE = new Set(['function', 'const', 'let', 'var', 'class', 'def', 'fn', 'func', 'struct', 'enum', 'interface', 'type', 'async', 'static', 'public', 'private', 'protected', 'readonly', 'extends', 'implements', 'new', 'lambda']);
const hex = (color: string) => (text: string) => chalk.hex(color)(text);

/**
 * Claude Code's syntax theme on dark backgrounds, "Monokai Extended" (2.1.283: /theme says so, and its
 * captures show `function` #66d9ef, names #a6e22e, strings #e6db74, text #f8f8f2).
 */
const MONOKAI_EXTENDED = {
  keyword: (text: string) => chalk.hex(STORAGE.has(text) ? '#66d9ef' : '#f92672')(text),
  built_in: hex('#ffffff'),
  type: hex('#66d9ef'),
  literal: hex('#be84ff'),
  number: hex('#be84ff'),
  regexp: hex('#e6db74'),
  string: hex('#e6db74'),
  subst: hex('#f8f8f2'),
  symbol: hex('#be84ff'),
  class: hex('#a6e22e'),
  function: hex('#f8f8f2'),
  title: hex('#a6e22e'),
  params: hex('#fd971f'),
  comment: hex('#75715e'),
  doctag: hex('#75715e'),
  meta: hex('#f92672'),
  'meta-keyword': hex('#f92672'),
  'meta-string': hex('#e6db74'),
  section: hex('#a6e22e'),
  tag: hex('#f92672'),
  name: hex('#f92672'),
  'builtin-name': hex('#66d9ef'),
  attr: hex('#a6e22e'),
  attribute: hex('#a6e22e'),
  variable: hex('#f8f8f2'),
  bullet: hex('#f92672'),
  code: hex('#e6db74'),
  emphasis: (text: string) => chalk.italic(text),
  strong: (text: string) => chalk.bold(text),
  formula: hex('#f8f8f2'),
  link: hex('#66d9ef'),
  quote: hex('#75715e'),
  'selector-tag': hex('#f92672'),
  'selector-id': hex('#a6e22e'),
  'selector-class': hex('#a6e22e'),
  'selector-attr': hex('#a6e22e'),
  'selector-pseudo': hex('#a6e22e'),
  'template-tag': hex('#f92672'),
  'template-variable': hex('#f8f8f2'),
  addition: hex('#a6e22e'),
  deletion: hex('#f92672'),
  default: hex('#f8f8f2'),
};

/** Monokai Extended for dark themes, as Claude Code; light and ANSI themes keep the terminal's colours. */
export function syntaxPalette(themeName: string): 'monokai' | 'terminal' {
  return themeName.startsWith('light') || themeName.endsWith('-ansi') ? 'terminal' : 'monokai';
}

export function highlightCode(code: string, lang?: string, palette: 'monokai' | 'terminal' = 'terminal'): string {
  const key = `${palette}\u0000${lang ?? ''}\u0000${code}`;
  const cached = highlightCache.get(key);
  if (cached) return cached;
  let out = code;
  try {
    const language = lang && supportsLanguage(lang) ? lang : undefined;
    out = highlight(code, { language, ignoreIllegals: true, ...(palette === 'monokai' ? { theme: MONOKAI_EXTENDED } : {}) });
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

/** A table cell as text segments; inline code keeps its colour, as in Claude Code's tables. */
type CellPart = { text: string; code?: boolean; bold?: boolean };
function cellParts(cell: Tokens.TableCell): CellPart[] {
  const walk = (tokens: Token[] | undefined, bold = false): CellPart[] => (tokens ?? []).flatMap((x: any) => {
    if (x.type === 'codespan') return [{ text: decode(x.text), code: true }];
    if (x.type === 'strong') return walk(x.tokens, true);
    if (x.tokens) return walk(x.tokens, bold);
    return [{ text: decode(x.text ?? x.raw ?? ''), bold }];
  });
  return walk(cell.tokens as Token[]);
}

function renderTable(t: Tokens.Table, theme: Theme, width: number, key: string): React.ReactNode {
  const header = t.header.map(cellParts);
  const rows = t.rows.map((r) => r.map(cellParts));
  const plain = (parts: CellPart[]) => parts.map((p) => p.text).join('');
  const cols = header.length;
  const maxCol = Math.max(3, Math.floor((width - 1 - 3 * cols) / Math.max(1, cols)));
  const widths = header.map((h, c) => Math.min(maxCol, Math.max(stringWidth(plain(h)), ...rows.map((r) => stringWidth(plain(r[c] ?? []))))));
  // Cut to the column, then pad on the side the alignment asks for (Claude Code centres the header).
  const cell = (parts: CellPart[], w: number, align: 'left' | 'center' | 'right') => {
    const kept: CellPart[] = [];
    let used = 0;
    for (const part of parts) {
      let text = part.text;
      while (text && used + stringWidth(text) > w) text = text.slice(0, -1);
      if (text) kept.push({ ...part, text });
      used += stringWidth(text);
      if (text !== part.text) break;
    }
    const gap = Math.max(0, w - used);
    const left = align === 'center' ? Math.floor(gap / 2) : align === 'right' ? gap : 0;
    return (
      <>
        {' '.repeat(left + 1)}
        {kept.map((p, i) => <Text key={i} color={p.code ? theme.code : undefined} bold={p.bold}>{p.text}</Text>)}
        {' '.repeat(gap - left + 1)}
      </>
    );
  };
  const alignOf = (c: number): 'left' | 'center' | 'right' => (t.align[c] === 'center' ? 'center' : t.align[c] === 'right' ? 'right' : 'left');
  const border = (left: string, mid: string, right: string) => left + widths.map((w) => '─'.repeat(w + 2)).join(mid) + right;
  const line = (cells: CellPart[][], header: boolean) => (
    <Text>│{cells.map((c, i) => <React.Fragment key={i}>{cell(c ?? [], widths[i], header ? 'center' : alignOf(i))}│</React.Fragment>)}</Text>
  );
  return (
    <Box key={key} flexDirection="column" marginY={0}>
      <Text>{border('┌', '┬', '┐')}</Text>
      {line(header, true)}
      {rows.map((r, i) => (
        <React.Fragment key={i}>
          <Text>{border('├', '┼', '┤')}</Text>
          {line(r, false)}
        </React.Fragment>
      ))}
      <Text>{border('└', '┴', '┘')}</Text>
    </Box>
  );
}

/** maxProseWidth (Claude Code 2.1.282): prose wraps at this width; code blocks and tables keep the full width. */
let proseLimit: number | undefined;
export function setMaxProseWidth(columns?: number): void {
  proseLimit = typeof columns === 'number' && Number.isFinite(columns) && columns > 0 ? Math.max(40, Math.floor(columns)) : undefined;
}
export function maxProseWidth(): number | undefined {
  return proseLimit;
}

function renderBlocks(tokens: Token[], theme: Theme, width: number, depth = 0, keyPrefix = ''): React.ReactNode[] {
  // Prose boxes are capped; the full width stays for code and tables.
  const prose = proseLimit && proseLimit < width ? proseLimit : undefined;
  const out: React.ReactNode[] = [];
  tokens.forEach((t, i) => {
    const key = `${keyPrefix}${i}`;
    switch (t.type) {
      case 'space':
        break;
      case 'heading': {
        const h = t as Tokens.Heading;
        out.push(
          <Box key={key} marginTop={out.length ? 1 : 0} width={prose}>
            <Text bold underline={h.depth <= 1}>{renderInline(h.tokens, theme, key + '-')}</Text>
          </Box>
        );
        break;
      }
      case 'paragraph':
        out.push(<Box key={key} marginTop={out.length ? 1 : 0} width={prose}><Text>{renderInline((t as Tokens.Paragraph).tokens, theme, key + '-')}</Text></Box>);
        break;
      case 'text': {
        const tk = t as Tokens.Text;
        out.push(<Box key={key} width={prose}><Text>{tk.tokens ? renderInline(tk.tokens, theme, key + '-') : decode(tk.text)}</Text></Box>);
        break;
      }
      case 'code': {
        const c = t as Tokens.Code;
        // Claude Code colours code in answers with the terminal's colours (Monokai is for diffs only).
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
            <Text dimColor>▎ </Text>
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
        // Claude Code 2.1.283 prints the rule as written, a block of its own.
        out.push(<Box key={key} marginTop={out.length ? 1 : 0}><Text>{(t as Tokens.Hr).raw.trim() || '---'}</Text></Box>);
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
