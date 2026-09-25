import React, { useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from './theme.js';
import { TabbedDialog, KeyValue } from './TabbedDialog.js';
import { ShortcutsHelp } from './ShortcutsHelp.js';
import { OverlayFrame } from './OverlayFrame.js';
import { Select } from './Select.js';
import { useRawInput } from './useRawInput.js';
import { APP_NAME } from '../branding.js';
import { StatsView } from './StatsView.js';
import type { SessionMeta } from '../session/store.js';

export interface InfoRow {
  label: string;
  value?: string;
  /** Shown in grey when there is no value, e.g. "/rename to add a name". */
  placeholder?: string;
}

export interface CommandEntry {
  name: string;
  description: string;
}

/** Claude Code's help colour. */
const HELP_BLUE = '#6a9bcc';

/** /help: General (what the agent does, shortcuts), Commands, Custom commands. */
export const HelpDialog: React.FC<{ commands: CommandEntry[]; custom: CommandEntry[]; onClose: () => void; ruleLabel?: string }> = ({ commands, custom, onClose, ruleLabel }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const rows = Math.max(4, (stdout.rows || 24) - 8);
  const list = (entries: CommandEntry[], empty: string) => (entries.length ? (
    <Box flexDirection="column">
      {entries.slice(0, rows).map((entry) => (
        <Text key={entry.name} wrap="truncate-end"><Text bold>{entry.name.padEnd(18)}</Text><Text color={theme.subtle}>{entry.description}</Text></Text>
      ))}
      {entries.length > rows ? <Text color={theme.subtle}>… +{entries.length - rows} more</Text> : null}
    </Box>
  ) : <Text color={theme.subtle}>{empty}</Text>);
  return (
    <TabbedDialog
      title="Help"
      color={HELP_BLUE}
      ruleLabel={ruleLabel}
      onClose={onClose}
      tabs={[
        {
          label: 'General',
          content: (
            <Box flexDirection="column">
              <Text>{APP_NAME} understands your codebase, makes edits with your permission, and executes commands — right from your terminal.</Text>
              <Text bold>Shortcuts</Text>
              <Box marginLeft={-2}><ShortcutsHelp color={theme.text} /></Box>
              <Text>For more help: <Text underline>README.md</Text></Text>
            </Box>
          ),
        },
        { label: 'Commands', content: list(commands, 'No commands.') },
        { label: 'Custom commands', content: list(custom, 'No custom commands. Add them in .fuller/commands/ or .fuller/skills/.') },
      ]}
    />
  );
};

/** One line of the Config tab: Enter/Space steps through `options`, or `onOpen` opens a picker. */
export interface ConfigItem {
  label: string;
  value: string;
  options?: string[];
  /** Grey line under the setting, e.g. why it cannot change. */
  description?: string;
  onChange?: (value: string) => void;
  onOpen?: () => void;
}

export type SettingsTab = 'status' | 'config' | 'usage' | 'stats';
type SettingsFocus = 'tabs' | 'search' | 'list';

const CONFIG_LABEL_WIDTH = 43;
const CONFIG_HINTS: Record<SettingsFocus, string> = {
  tabs: '←/→/tab to switch · ↓ to return · Esc to close',
  search: 'Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear',
  list: 'Enter/Space to change · / to search · Esc to close',
};

/**
 * /status, /config and /usage: Claude Code's Settings dialog with its Status, Config, Usage and
 * Stats tabs. ←/→ or Tab move between tabs and stay on the tab row, Config included (↓ then
 * enters its search field, ↓ again its list). /config opens on the search field. Status and
 * Usage scroll with ↑/↓, PgUp/PgDn and Home/End when taller than the screen, with ↑/↓ marks on
 * the right edge as in Claude Code.
 */
export const SettingsDialog: React.FC<{ status: InfoRow[]; usage: InfoRow[]; config?: ConfigItem[]; stats?: () => { sessions: SessionMeta[]; prompts: number[] }; initialTab: SettingsTab; onClose: () => void; ruleLabel?: string }> = ({ status, usage, config = [], stats, initialTab, onClose, ruleLabel }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const tabs: Array<{ key: SettingsTab; label: string }> = [{ key: 'status', label: 'Status' }, ...(config.length ? [{ key: 'config' as const, label: 'Config' }] : []), { key: 'usage', label: 'Usage' }, ...(stats ? [{ key: 'stats' as const, label: 'Stats' }] : [])];
  const [tab, setTab] = useState(Math.max(0, tabs.findIndex((t) => t.key === initialTab)));
  const current = tabs[tab]?.key ?? 'status';
  const [focus, setFocus] = useState<SettingsFocus>(initialTab === 'config' ? 'search' : 'tabs');
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [scroll, setScroll] = useState(0);
  const lines = current === 'usage' ? usage : status;
  const linesPage = Math.max(3, (stdout.rows || 24) - 8);
  const maxScroll = Math.max(0, lines.length - linesPage);
  const top = Math.min(scroll, maxScroll);
  const items = config
    .map((item) => ({ ...item, value: values[item.label] ?? item.value }))
    .filter((item) => !query || `${item.label} ${item.value}`.toLowerCase().includes(query.toLowerCase()));
  const safe = Math.max(0, Math.min(index, items.length - 1));
  const page = Math.max(3, (stdout.rows || 24) - 14);
  const offset = Math.max(0, Math.min(safe - page + 1, items.length - page));

  const switchTab = (delta: number) => {
    const next = (tab + delta + tabs.length) % tabs.length;
    setTab(next);
    setIndex(0);
    setQuery('');
    setScroll(0);
    // Stay on the tab row, so that →, → walks through every tab (Config's search field took the keys).
    setFocus('tabs');
  };
  const change = () => {
    const item = items[safe];
    if (!item) return;
    if (item.onOpen) { onClose(); item.onOpen(); return; }
    if (!item.options?.length) return;
    const next = item.options[(item.options.indexOf(item.value) + 1) % item.options.length];
    setValues((v) => ({ ...v, [item.label]: next }));
    item.onChange?.(next);
  };

  useRawInput((e) => {
    if (e.name === 'char' && e.ctrl && e.text === 'c') { onClose(); return; }
    if (current === 'config' && focus === 'search') {
      if (e.name === 'escape') { if (query) { setQuery(''); setIndex(0); } else onClose(); }
      else if (e.name === 'up') setFocus('tabs');
      else if (e.name === 'down' || e.name === 'return') { if (items.length) { setFocus('list'); setIndex(0); } }
      else if (e.name === 'backspace') { setQuery((q) => q.slice(0, -1)); setIndex(0); }
      else if (e.name === 'char' && !e.ctrl && !e.alt) { setQuery((q) => q + e.text); setIndex(0); }
      else if (e.name === 'paste') setQuery((q) => q + e.text.replace(/\s+/g, ' '));
      else if (e.name === 'tab') switchTab(e.shift ? -1 : 1);
      return;
    }
    if (current === 'config' && focus === 'list') {
      if (e.name === 'escape') onClose();
      else if (e.name === 'up') { if (safe === 0) setFocus('search'); else setIndex(safe - 1); }
      else if (e.name === 'down') setIndex(Math.min(items.length - 1, safe + 1));
      else if (e.name === 'return' || (e.name === 'char' && e.text === ' ')) change();
      else if (e.name === 'char' && e.text === '/') setFocus('search');
      else if (e.name === 'tab') switchTab(e.shift ? -1 : 1);
      return;
    }
    if (e.name === 'escape') onClose();
    else if (e.name === 'right' || (e.name === 'tab' && !e.shift)) switchTab(1);
    else if (e.name === 'left' || (e.name === 'tab' && e.shift)) switchTab(-1);
    else if (current === 'config' && (e.name === 'down' || e.name === 'return')) setFocus('search');
    else if (current === 'status' || current === 'usage') {
      const to = e.name === 'down' ? top + 1 : e.name === 'up' ? top - 1 : e.name === 'pagedown' ? top + linesPage : e.name === 'pageup' ? top - linesPage
        : e.name === 'home' ? 0 : e.name === 'end' ? maxScroll : undefined;
      if (to !== undefined) setScroll(Math.max(0, Math.min(maxScroll, to)));
    }
  });

  const header = (
    <Text wrap="truncate-end">
      <Text bold color={theme.permission}>Settings</Text>
      {tabs.map((t, i) => (i !== tab
        ? <Text key={t.key}>{' '}{` ${t.label} `}</Text>
        : focus === 'tabs'
          ? <Text key={t.key}>{' '}<Text bold color="#000000" backgroundColor={theme.permission}>{` ${t.label} `}</Text></Text>
          : <Text key={t.key}>{' '}<Text bold inverse>{` ${t.label} `}</Text></Text>))}
    </Text>
  );
  const width = Math.max(20, (stdout.columns || 80) - 5);
  const rows = (entries: InfoRow[]) => {
    if (entries.length <= linesPage) {
      return (
        <Box flexDirection="column">
          {entries.map((row) => <KeyValue key={row.label} label={row.label} value={row.value} placeholder={row.placeholder} />)}
        </Box>
      );
    }
    // Taller than the screen: one page, with Claude Code's ↑/↓ marks on the right edge.
    const visible = entries.slice(top, top + linesPage);
    return (
      <Box flexDirection="column">
        {visible.map((row, i) => (
          <Box key={row.label} width={width}>
            <Box flexGrow={1}><KeyValue label={row.label} value={row.value} placeholder={row.placeholder} /></Box>
            <Text color={theme.subtle}>{i === 0 && top > 0 ? '↑' : i === visible.length - 1 && top + linesPage < entries.length ? '↓' : ' '}</Text>
          </Box>
        ))}
      </Box>
    );
  };
  const configView = (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={focus === 'search' ? theme.permission : undefined} borderDimColor={focus !== 'search'} width={width} paddingX={1}>
        {query ? <Text>⌕ {query}</Text> : focus === 'search' ? <Text>⌕ <Text color={theme.subtle}>Search settings…</Text></Text> : <Text color={theme.subtle}>⌕ Search settings…</Text>}
      </Box>
      {items.length === 0 ? <Text color={theme.subtle}>  No settings match "{query}"</Text> : null}
      {items.slice(offset, offset + page).map((item, i) => {
        const selected = focus === 'list' && offset + i === safe;
        return (
          <Box key={item.label} flexDirection="column">
            <Text wrap="truncate-end" color={selected ? theme.permission : undefined}>{selected ? '❯ ' : '  '}{item.label.padEnd(CONFIG_LABEL_WIDTH)}{item.value}</Text>
            {item.description ? <Text color={theme.subtle} wrap="truncate-end">    {item.description}</Text> : null}
          </Box>
        );
      })}
      {items.length > offset + page ? <Text color={theme.subtle}>  ↓ {items.length - offset - page} more below</Text> : null}
    </Box>
  );
  return (
    <OverlayFrame title="Settings" header={header} hint={current === 'config' ? CONFIG_HINTS[focus] : current === 'stats' ? undefined : 'Esc to cancel'} ruleLabel={ruleLabel}>
      <Box flexDirection="column">{current === 'config' ? configView : current === 'stats' && stats ? <StatsView load={stats} width={width} /> : rows(lines)}</Box>
    </OverlayFrame>
  );
};

export interface ListItem {
  label: string;
  hint?: string;
  /** Leading status glyph (✔, ⚠, ◯, ✘) and its colour. */
  glyph?: string;
  glyphColor?: 'success' | 'warning' | 'error' | 'subtle';
  /** Runs after the dialog closes when the item is chosen with Enter. */
  onSelect?: () => void;
  /** Runs after the dialog closes when the list's shortcut key is pressed on this item (/tasks: x stops the task). */
  onShortcut?: () => void;
}

/**
 * Read-only list dialog in Claude Code's style (/memory, /mcp, /hooks, /tasks):
 * a title, a few header lines, a list and the key hint.
 */
export const ListDialog: React.FC<{ title: string; header?: string[]; items: ListItem[]; empty?: string; footer?: string; numbered?: boolean; hint?: string; shortcutKey?: string; onClose: () => void; ruleLabel?: string }> = ({ title, header = [], items, empty, footer, numbered = true, hint, shortcutKey, onClose, ruleLabel }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const labelWidth = Math.min(32, Math.max(10, ...items.map((item) => item.label.length + (item.glyph ? 2 : 0) + 3)));
  return (
    <OverlayFrameList title={title} hint={hint ?? (items.length ? '↑/↓ to navigate · Enter to confirm · Esc to cancel' : 'Esc to cancel')} ruleLabel={ruleLabel} onClose={onClose} itemsEmpty={items.length === 0}>
      {header.map((line, i) => <Text key={i} color={i === 0 ? theme.text : theme.subtle} wrap="wrap">{line}</Text>)}
      {items.length === 0 && empty ? <Text color={theme.subtle}>{empty}</Text> : null}
      {items.length ? (
        <Select
          items={items.map((item, i) => ({
            label: item.glyph ? `${item.glyph} ${item.label}` : item.label,
            value: i,
            hint: item.hint,
          }))}
          numbered={numbered}
          labelWidth={labelWidth}
          maxVisible={Math.max(3, (stdout.rows || 24) - 10 - header.length)}
          onSelect={(i) => { onClose(); items[i]?.onSelect?.(); }}
          shortcutKey={shortcutKey}
          onShortcutSelect={(i) => { if (items[i]?.onShortcut) { onClose(); items[i].onShortcut!(); } }}
          onCancel={onClose}
        />
      ) : null}
      {footer ? <Text color={theme.subtle} wrap="wrap">{footer}</Text> : null}
    </OverlayFrameList>
  );
};

/** OverlayFrame that also closes with Esc when there is no list to take the keys. */
const OverlayFrameList: React.FC<{ title: string; hint: string; ruleLabel?: string; onClose: () => void; itemsEmpty: boolean; children: React.ReactNode }> = ({ title, hint, ruleLabel, onClose, itemsEmpty, children }) => {
  useRawInput((e) => { if (e.name === 'escape' || (e.name === 'char' && e.ctrl && e.text === 'c')) onClose(); }, { isActive: itemsEmpty });
  return <OverlayFrame title={title} hint={hint} ruleLabel={ruleLabel}><Box flexDirection="column">{children}</Box></OverlayFrame>;
};

/**
 * Text entry dialog in Claude Code's style (/add-dir): a description, a label,
 * a framed field with a placeholder, Tab to complete, Enter to submit.
 */
export const InputDialog: React.FC<{ title: string; description?: string; label?: string; placeholder?: string; hint?: string; complete?: (value: string) => string; onSubmit: (value: string) => void; onClose: () => void; ruleLabel?: string }> = ({ title, description, label, placeholder, hint = 'Enter to confirm · Esc to cancel', complete, onSubmit, onClose, ruleLabel }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const [value, setValue] = React.useState('');
  useRawInput((e) => {
    if (e.name === 'escape' || (e.name === 'char' && e.ctrl && e.text === 'c')) onClose();
    else if (e.name === 'return') { if (value.trim()) { onClose(); onSubmit(value.trim()); } }
    else if (e.name === 'tab' && complete) setValue((v) => complete(v));
    else if (e.name === 'backspace') setValue((v) => v.slice(0, -1));
    else if (e.name === 'paste') setValue((v) => v + e.text.replace(/\s*\n\s*/g, ''));
    else if (e.name === 'char' && !e.ctrl && !e.alt) setValue((v) => v + e.text);
  });
  return (
    <OverlayFrame title={title} hint={hint} ruleLabel={ruleLabel}>
      <Box flexDirection="column">
        {description ? <Text wrap="wrap">{description}</Text> : null}
        {label ? <Text>{label}</Text> : null}
        <Box borderStyle="round" borderColor={theme.permission} width={Math.max(20, (stdout.columns || 80) - 7)} paddingX={1}>
          <Text>{value}{value ? <Text inverse> </Text> : <><Text inverse>{(placeholder ?? ' ')[0]}</Text><Text color={theme.subtle}>{(placeholder ?? '').slice(1)}</Text></>}</Text>
        </Box>
      </Box>
    </OverlayFrame>
  );
};

/** Tab completion for directory paths: the longest common prefix of the matching sub-directories. */
export function completeDirectory(value: string, base: string, fs: typeof import('node:fs'), path: typeof import('node:path')): string {
  const expanded = value.startsWith('~') ? (process.env.HOME ?? '') + value.slice(1) : value;
  const absolute = path.resolve(base, expanded || '.');
  const endsWithSlash = /[/\\]$/.test(value);
  const dir = endsWithSlash || !value ? absolute : path.dirname(absolute);
  const prefix = endsWithSlash || !value ? '' : path.basename(absolute);
  let names: string[] = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith(prefix) && !d.name.startsWith('.')).map((d) => d.name); } catch { return value; }
  if (!names.length) return value;
  let common = names[0];
  for (const name of names) while (!name.startsWith(common)) common = common.slice(0, -1);
  const head = endsWithSlash || !value ? value : value.slice(0, value.length - prefix.length);
  return `${head}${common}${names.length === 1 ? '/' : ''}`;
}
