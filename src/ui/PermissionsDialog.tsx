import React, { useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import stringWidth from 'string-width';
import { useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';
import { OverlayFrame } from './OverlayFrame.js';
import { shortAge } from './AgentsView.js';
import { APP_NAME } from '../branding.js';
import { builtinRuleCounts } from '../permissions/autoMode.js';

type RuleKind = 'allow' | 'ask' | 'deny';
type TabKey = 'recent' | RuleKind | 'auto' | 'workspace';
type Focus = 'tabs' | 'search' | 'list';
type BuiltinGroup = 'softAllow' | 'softDeny';

const TABS: Array<{ key: TabKey; label: string; description: string }> = [
  { key: 'recent', label: 'Recently denied', description: 'No recent denials. Commands denied by the auto mode classifier will appear here.' },
  { key: 'allow', label: 'Allow', description: `${APP_NAME} won't ask before using allowed tools.` },
  { key: 'ask', label: 'Ask', description: `${APP_NAME} will always ask for confirmation before using these tools.` },
  { key: 'deny', label: 'Deny', description: `${APP_NAME} will always reject requests to use denied tools.` },
  { key: 'auto', label: 'Auto mode', description: 'Extra rules for the auto mode classifier. Rules are plain sentences; new rules are saved to your user settings.' },
  { key: 'workspace', label: 'Workspace', description: `${APP_NAME} can read files in the workspace, and make edits when auto-accept edits is on.` },
];
const FIRST_TAB = 1;

const HINTS: Record<Focus, string> = {
  tabs: '←/→ to switch · ↓ to select · Esc to cancel',
  search: 'Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear',
  list: '↑/↓ to navigate · Enter to select · ←/→ to switch · Esc to cancel',
};

export interface Denial {
  action: string;
  reason: string;
  timestamp: number;
}

interface Props {
  allow: string[];
  ask: string[];
  deny: string[];
  directories: string[];
  /** Auto mode denials, newest first. */
  denials?: Denial[];
  /** The user's auto mode rules and the built-in groups turned off. */
  autoRules?: string[];
  disabledBuiltin?: BuiltinGroup[];
  onAddRule: (kind: RuleKind, rule: string) => void;
  onRemoveRule: (rule: string) => void;
  onAddAutoRule?: (rule: string) => void;
  onRemoveAutoRule?: (rule: string) => void;
  onToggleBuiltin?: (group: BuiltinGroup) => void;
  /** "Add directory…": opens the /add-dir window. */
  onAddDirectory: () => void;
  onClose: () => void;
  ruleLabel?: string;
}

interface Row {
  label: string;
  /** Drawn instead of the label (the built-in groups). */
  node?: React.ReactNode;
  action: 'add' | 'remove' | 'toggle' | 'directory' | 'none';
  group?: BuiltinGroup;
}

/**
 * /permissions laid out like Claude Code 2.1.281: "Permissions" and its tabs
 * (Recently denied, Allow, Ask, Deny, Auto mode, Workspace), the tab's meaning,
 * a search field as wide as that line, "1. Add a new rule…" and the rules.
 * Focus starts on the tabs (←/→); ↓ enters the list, / the search. Off focus
 * the current tab is bold and inverse.
 */
export const PermissionsDialog: React.FC<Props> = ({ allow, ask, deny, directories, denials = [], autoRules = [], disabledBuiltin = [], onAddRule, onRemoveRule, onAddAutoRule, onRemoveAutoRule, onToggleBuiltin, onAddDirectory, onClose, ruleLabel }) => {
  const theme = useTheme();
  const { stdout } = useStdout();
  const [tab, setTab] = useState(FIRST_TAB);
  const [focus, setFocus] = useState<Focus>('tabs');
  const [index, setIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const current = TABS[tab];
  const searchable = current.key !== 'workspace' && current.key !== 'recent';
  const filter = (items: string[]) => items.filter((item) => !query || item.toLowerCase().includes(query.toLowerCase()));
  const counts = builtinRuleCounts();

  let rows: Row[] = [];
  if (current.key === 'allow' || current.key === 'ask' || current.key === 'deny') {
    const rules = current.key === 'allow' ? allow : current.key === 'ask' ? ask : deny;
    rows = [...(query ? [] : [{ label: 'Add a new rule…', action: 'add' as const }]), ...filter(rules).map((rule) => ({ label: rule, action: 'remove' as const }))];
  } else if (current.key === 'auto') {
    const group = (label: string, color: string, count: number, key?: BuiltinGroup): Row => ({
      label,
      action: key ? 'toggle' : 'none',
      group: key,
      node: <Text><Text color={color}>{label.padEnd(20)}</Text>[{key && disabledBuiltin.includes(key) ? ' ' : 'x'}] Built-in rules<Text color={theme.subtle}> · {count}</Text></Text>,
    });
    rows = query
      ? filter(autoRules).map((rule) => ({ label: rule, action: 'remove' as const }))
      : [
        { label: 'Add a new rule…', action: 'add' },
        group('Soft allow', theme.success, counts.softAllow, 'softAllow'),
        group('Soft deny', theme.warning, counts.softDeny, 'softDeny'),
        group('Hard deny', theme.error, counts.hardDeny),
        ...autoRules.map((rule) => ({ label: rule, action: 'remove' as const })),
      ];
  } else if (current.key === 'workspace') {
    rows = [{ label: 'Add directory…', action: 'directory' }];
  }
  const safe = Math.max(0, Math.min(index, rows.length - 1));

  const switchTab = (delta: number) => { setTab((t) => (t + delta + TABS.length) % TABS.length); setIndex(0); setQuery(''); if (focus === 'search') setFocus('tabs'); };
  const choose = () => {
    const row = rows[safe];
    if (!row) return;
    if (row.action === 'directory') onAddDirectory();
    else if (row.action === 'add') setDraft('');
    else if (row.action === 'toggle' && row.group) onToggleBuiltin?.(row.group);
    else if (row.action === 'remove') setConfirm(row.label);
  };

  useRawInput((e) => {
    if (draft !== null) {
      if (e.name === 'escape') setDraft(null);
      else if (e.name === 'return') {
        const value = draft.trim();
        if (value && current.key === 'auto') onAddAutoRule?.(value);
        else if (value && (current.key === 'allow' || current.key === 'ask' || current.key === 'deny')) onAddRule(current.key, value);
        setDraft(null);
      } else if (e.name === 'backspace') setDraft((d) => (d ?? '').slice(0, -1));
      else if (e.name === 'char' && !e.ctrl && !e.alt) setDraft((d) => (d ?? '') + e.text);
      else if (e.name === 'paste') setDraft((d) => (d ?? '') + e.text.replace(/\s+/g, ' '));
      return;
    }
    if (confirm !== null) {
      if (e.name === 'return') { if (current.key === 'auto') onRemoveAutoRule?.(confirm); else onRemoveRule(confirm); setConfirm(null); setIndex(0); }
      else if (e.name === 'escape') setConfirm(null);
      return;
    }
    if (e.name === 'char' && e.ctrl && e.text === 'c') { onClose(); return; }
    if (focus === 'search') {
      if (e.name === 'escape') { if (query) { setQuery(''); setIndex(0); } else setFocus('tabs'); }
      else if (e.name === 'up') setFocus('tabs');
      else if (e.name === 'down' || e.name === 'return') { if (rows.length) { setFocus('list'); setIndex(0); } }
      else if (e.name === 'backspace') { setQuery((q) => q.slice(0, -1)); setIndex(0); }
      else if (e.name === 'char' && !e.ctrl && !e.alt) { setQuery((q) => q + e.text); setIndex(0); }
      else if (e.name === 'paste') setQuery((q) => q + e.text.replace(/\s+/g, ' '));
      return;
    }
    if (e.name === 'escape') onClose();
    else if (e.name === 'right' || (e.name === 'tab' && !e.shift)) switchTab(1);
    else if (e.name === 'left' || (e.name === 'tab' && e.shift)) switchTab(-1);
    else if (focus === 'tabs') {
      if ((e.name === 'down' || e.name === 'return') && rows.length) { setFocus('list'); setIndex(0); }
      else if (e.name === 'char' && e.text === '/' && searchable) setFocus('search');
    } else {
      if (e.name === 'up') { if (safe === 0) setFocus(searchable ? 'search' : 'tabs'); else setIndex(safe - 1); }
      else if (e.name === 'down') setIndex(Math.min(rows.length - 1, safe + 1));
      else if (e.name === 'return') choose();
      else if (e.name === 'char' && e.text === '/' && searchable) setFocus('search');
    }
  });

  if (draft !== null && (current.key === 'allow' || current.key === 'ask' || current.key === 'deny' || current.key === 'auto')) {
    // "Add allow permission rule": explanation, an example and a full-width field.
    const width = Math.max(20, (stdout.columns || 80) - 6);
    const auto = current.key === 'auto';
    return (
      <OverlayFrame title={auto ? 'Add auto mode rule' : `Add ${current.key} permission rule`} hint="Enter to submit · Esc to cancel" ruleLabel={ruleLabel}>
        {auto ? (
          <>
            <Text>Auto mode rules are plain sentences the classifier follows before its built-in rules.</Text>
            <Text>e.g., <Text bold>Allow running npm scripts</Text> or <Text bold>Never touch the deploy folder</Text></Text>
          </>
        ) : (
          <>
            <Text>Permission rules are a tool name, optionally followed by a specifier in parentheses.</Text>
            <Text>e.g., <Text bold>WebFetch</Text> or <Text bold>Bash(ls *)</Text></Text>
          </>
        )}
        <Box borderStyle="round" borderDimColor width={width} paddingX={1}>
          {draft ? <Text>{draft}<Text inverse> </Text></Text> : <Text dimColor>{auto ? 'Enter auto mode rule…' : 'Enter permission rule…'}</Text>}
        </Box>
      </OverlayFrame>
    );
  }

  const header = (
    <Text wrap="truncate-end">
      <Text bold color={theme.permission}>Permissions</Text>
      {TABS.map((t, i) => (i !== tab
        ? <Text key={t.key}>{' '}{` ${t.label} `}</Text>
        : focus === 'tabs'
          ? <Text key={t.key}>{' '}<Text bold color="#000000" backgroundColor={theme.permission}>{` ${t.label} `}</Text></Text>
          : <Text key={t.key}>{' '}<Text bold inverse>{` ${t.label} `}</Text></Text>))}
    </Text>
  );
  const hint = confirm !== null ? 'Enter to delete · Esc to cancel' : HINTS[focus];
  // Claude Code's search field is exactly as wide as the tab's description.
  const maxWidth = Math.max(20, (stdout.columns || 80) - 6);
  const searchWidth = Math.min(Math.max(20, stringWidth(current.description)), maxWidth);

  return (
    <OverlayFrame title="Permissions" header={header} hint={hint} ruleLabel={ruleLabel}>
      <Box flexDirection="column">
        {current.key === 'recent' ? (
          denials.length ? denials.slice(0, Math.max(3, (stdout.rows || 24) - 12)).map((denial, i) => (
            <Text key={i} wrap="truncate-end">  {denial.action}<Text color={theme.subtle}>  {denial.reason} · {shortAge(Date.now() - denial.timestamp)} ago</Text></Text>
          )) : <Text color={theme.subtle}>{current.description}</Text>
        ) : <Text wrap="wrap">{current.description}</Text>}
        {searchable ? (
          <Box borderStyle="round" borderColor={focus === 'search' ? theme.permission : undefined} borderDimColor={focus !== 'search'} width={searchWidth} paddingX={1}>
            {query ? <Text>⌕ {query}</Text> : focus === 'search' ? <Text>⌕ <Text color={theme.subtle}>Search…</Text></Text> : <Text color={theme.subtle}>⌕ Search…</Text>}
          </Box>
        ) : current.key === 'workspace' ? directories.map((dir, i) => (
          <Text key={dir} wrap="truncate-end">  -  {dir}{i === 0 ? <Text color={theme.subtle}> (Original working directory)</Text> : null}</Text>
        )) : null}
        {confirm !== null ? <Text color={theme.warning}>Delete rule {confirm}?</Text> : null}
        {/* Claude Code: a blank row between the search field and the rules (2.1.283 capture). */}
        <Box flexDirection="column" marginTop={rows.length && (stdout.rows || 24) >= 16 ? 1 : 0}>
          {rows.map((row, i) => {
            const selected = focus === 'list' && i === safe && confirm === null;
            return (
              <Text key={`${i}-${row.label}`} wrap="truncate-end">
                <Text color={theme.permission}>{selected ? '❯ ' : '  '}</Text>
                <Text color={theme.subtle}>{i + 1}. </Text>
                {row.node ?? <Text color={selected ? theme.permission : undefined}>{row.label}</Text>}
              </Text>
            );
          })}
        </Box>
      </Box>
    </OverlayFrame>
  );
};
