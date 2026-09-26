import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { useTheme } from './theme.js';
import { useRawInput } from './useRawInput.js';
import { OverlayFrame } from './OverlayFrame.js';
import { useSpinnerFrame } from './Spinner.js';
import { tildePath } from './externalEditor.js';
import { CONFIG_DIR_NAME } from '../branding.js';
import type { McpServerStatus, McpToolInfo } from '../mcp/manager.js';

/** What /mcp needs from the session. */
export interface McpApi {
  statuses(): McpServerStatus[];
  toolsOf(server: string): McpToolInfo[];
  reconnect(name: string): Promise<McpServerStatus>;
  setEnabled(name: string, enabled: boolean): Promise<McpServerStatus>;
}

type View =
  | { view: 'list' }
  | { view: 'server'; name: string }
  | { view: 'tools'; name: string }
  | { view: 'tool'; name: string; tool: string }
  | { view: 'busy'; name: string };

const capital = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
/** Claude Code writes a project's file in full and the user's with "~". */
const where = (status: McpServerStatus) => (status.scope === 'user' ? tildePath(status.file) : status.file);

/** Claude Code's answer to Reconnect, shown under "❯ /mcp" when the dialog closes. */
export function reconnectMessage(status: McpServerStatus): string {
  if (status.status === 'connected') return `Reconnected to ${status.name}.`;
  return status.error ? `Failed to reconnect to ${status.name}: ${status.error}` : `Failed to reconnect to ${status.name}.`;
}

/** "● text (required): string - Text to echo", one line per parameter of a tool. */
export function parameterLines(schema: any): Array<{ name: string; required: boolean; detail: string }> {
  const properties = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = new Set<string>(Array.isArray(schema?.required) ? schema.required : []);
  return Object.entries<any>(properties).map(([name, prop]) => {
    const type = Array.isArray(prop?.type) ? prop.type.join(' | ') : prop?.type ?? (prop?.enum ? 'enum' : 'any');
    return { name, required: required.has(name), detail: prop?.description ? `${type} - ${prop.description}` : String(type) };
  });
}

/**
 * /mcp as in Claude Code 2.1.283 (captured 26/09): the servers grouped by the file that declares
 * them, then a server's menu (View tools, Reconnect, Disable or Enable), its tools and a tool's
 * parameters. Esc goes back one level; Reconnect closes the dialog with its result.
 */
export const McpDialog: React.FC<{ api: McpApi; onClose: (message?: string) => void; ruleLabel?: string }> = ({ api, onClose, ruleLabel }) => {
  const theme = useTheme();
  const [view, setView] = useState<View>({ view: 'list' });
  const [index, setIndex] = useState(0);
  const [, setTick] = useState(0);
  const frame = useSpinnerFrame(view.view === 'busy');
  // Servers connect in the background: follow their state while the dialog is open.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 300);
    return () => clearInterval(timer);
  }, []);

  const statuses = api.statuses();
  const server = 'name' in view ? statuses.find((s) => s.name === view.name) : undefined;
  const tools = server ? api.toolsOf(server.name) : [];
  const actions: Array<{ label: string; run: () => void }> = [];
  if (server) {
    if (server.status === 'connected' && server.toolCount > 0) actions.push({ label: 'View tools', run: () => go({ view: 'tools', name: server.name }) });
    if (server.status !== 'disabled') actions.push({ label: 'Reconnect', run: () => void reconnect(server.name) });
    actions.push({ label: server.status === 'disabled' ? 'Enable' : 'Disable', run: () => void toggle(server) });
  }

  function go(next: View, at = 0) { setView(next); setIndex(at); }
  const listIndexOf = (name: string) => Math.max(0, statuses.findIndex((s) => s.name === name));

  async function reconnect(name: string) {
    go({ view: 'busy', name });
    try { onClose(reconnectMessage(await api.reconnect(name))); }
    catch (error: any) { onClose(`Error reconnecting to ${name}: ${error?.message ?? String(error)}`); }
  }

  async function toggle(target: McpServerStatus) {
    try { await api.setEnabled(target.name, target.status === 'disabled'); }
    catch (error: any) { onClose(`Failed to ${target.status === 'disabled' ? 'enable' : 'disable'} ${target.name}: ${error?.message ?? String(error)}`); return; }
    // Claude Code goes back to the list, the server marked ◯ (or connecting again).
    go({ view: 'list' }, listIndexOf(target.name));
  }

  const count = view.view === 'list' ? statuses.length : view.view === 'server' ? actions.length : view.view === 'tools' ? tools.length : 0;
  useRawInput((e) => {
    if (view.view === 'busy') return;
    const back = e.name === 'escape' || (e.name === 'char' && e.ctrl && e.text === 'c');
    if (back) {
      if (view.view === 'list') onClose();
      else if (view.view === 'server') go({ view: 'list' }, listIndexOf(view.name));
      else if (view.view === 'tools') go({ view: 'server', name: view.name });
      else go({ view: 'tools', name: view.name }, Math.max(0, tools.findIndex((t) => t.name === view.tool)));
      return;
    }
    if (!count) return;
    if (e.name === 'up' || (e.name === 'char' && !e.alt && ((e.text === 'k' && !e.ctrl) || (e.text === 'p' && e.ctrl)))) setIndex((i) => (i <= 0 ? count - 1 : i - 1));
    else if (e.name === 'down' || (e.name === 'char' && !e.alt && ((e.text === 'j' && !e.ctrl) || (e.text === 'n' && e.ctrl)))) setIndex((i) => (i >= count - 1 ? 0 : i + 1));
    else if (e.name === 'return') choose(Math.min(index, count - 1));
    else if (view.view === 'server' && e.name === 'char' && /^[1-9]$/.test(e.text) && parseInt(e.text, 10) <= count) choose(parseInt(e.text, 10) - 1);
  });

  function choose(i: number) {
    if (view.view === 'list') { const target = statuses[i]; if (target) go({ view: 'server', name: target.name }); }
    else if (view.view === 'server') actions[i]?.run();
    else if (view.view === 'tools') { const tool = tools[i]; if (tool) go({ view: 'tool', name: view.name, tool: tool.name }); }
  }

  const pointer = (selected: boolean) => <Text color={selected ? theme.permission : theme.subtle}>{selected ? '❯ ' : '  '}</Text>;
  const blank = <Text> </Text>;

  if (view.view === 'list') {
    // One heading per file, in the order the servers were read (project first, then the user's).
    const groups: Array<{ file: string; scope: McpServerStatus['scope']; items: Array<{ status: McpServerStatus; at: number }> }> = [];
    statuses.forEach((status, at) => {
      const group = groups.find((g) => g.file === status.file) ?? groups[groups.push({ file: status.file, scope: status.scope, items: [] }) - 1];
      group.items.push({ status, at });
    });
    return (
      <OverlayFrame title="Manage MCP servers" hint={statuses.length ? '↑/↓ to navigate · Enter to confirm · Esc to cancel' : 'Esc to cancel'} ruleLabel={ruleLabel}>
        <Text color={theme.subtle}>{statuses.length} {statuses.length === 1 ? 'server' : 'servers'}</Text>
        {statuses.length === 0 ? <><Text color={theme.subtle}>No MCP servers configured.</Text>{blank}</> : null}
        {groups.map((group) => (
          <Box key={group.file} flexDirection="column">
            {blank}
            <Text>  <Text bold>{group.scope === 'user' ? 'User MCPs' : 'Project MCPs'}</Text><Text color={theme.subtle}> ({where(group.items[0].status)})</Text></Text>
            {group.items.map(({ status, at }) => {
              const selected = at === Math.min(index, statuses.length - 1);
              const [glyph, color] = status.status === 'connected' ? ['✔', theme.success] : status.status === 'failed' ? ['✘', theme.error] : ['◯', theme.subtle];
              const hint = status.status === 'connected' ? `${status.toolCount} ${status.toolCount === 1 ? 'tool' : 'tools'}` : status.status === 'failed' ? 'failed' : status.status === 'connecting' ? 'connecting…' : '';
              return (
                <Text key={status.name} wrap="truncate-end">
                  {pointer(selected)}<Text color={color}>{glyph} </Text><Text color={selected ? theme.permission : theme.text}>{status.name}</Text>{hint ? <Text color={theme.subtle}>   {hint}</Text> : null}
                </Text>
              );
            })}
          </Box>
        ))}
        {blank}
        <Text color={theme.subtle} wrap="wrap">Servers come from .mcp.json, {CONFIG_DIR_NAME}/mcp.json and ~/{CONFIG_DIR_NAME}/mcp.json</Text>
      </OverlayFrame>
    );
  }

  if (!server) return <OverlayFrame title="Manage MCP servers" hint="Esc to cancel" ruleLabel={ruleLabel}><Text color={theme.subtle}>This server is no longer configured.</Text></OverlayFrame>;
  const title = `${capital(server.name)} MCP Server`;

  if (view.view === 'busy') {
    return (
      <OverlayFrame title={title} ruleLabel={ruleLabel}>
        {blank}
        <Text color={theme.text}>Reconnecting to <Text bold>{server.name}</Text></Text>
        {blank}
        <Text><Text color={theme.accent}>{frame}</Text>  Restarting MCP server process</Text>
        {blank}
        <Text color={theme.subtle}>This may take a few moments.</Text>
      </OverlayFrame>
    );
  }

  if (view.view === 'server') {
    const rows: Array<[string, React.ReactNode]> = [
      ['Status:', statusText(server)],
      [server.transport === 'http' ? 'URL:' : 'Command:', <Text color={theme.subtle}>{server.endpoint}</Text>],
      ['Config location:', <Text color={theme.subtle}>{where(server)}</Text>],
    ];
    if (server.status === 'failed' && server.error) rows.splice(1, 0, ['Issue:', <Text color={theme.subtle}>{server.error}</Text>]);
    const labelWidth = Math.max(...rows.map(([label]) => stringWidth(label))) + 2;
    return (
      <OverlayFrame title={title} hint="↑/↓ to navigate · Enter to select · Esc to back" ruleLabel={ruleLabel}>
        {blank}
        {rows.map(([label, value]) => (
          <Box key={label}>
            <Box width={labelWidth} flexShrink={0}><Text bold>{label}</Text></Box>
            <Box flexShrink={1}><Text wrap="truncate-end">{value}</Text></Box>
          </Box>
        ))}
        {server.status === 'connected' && server.capabilities?.length ? <Text><Text bold>Capabilities: </Text><Text color={theme.text}>{server.capabilities.join(' · ')}</Text></Text> : null}
        {server.status === 'connected' && server.toolCount > 0 ? <Text><Text bold>Tools: </Text><Text color={theme.subtle}>{server.toolCount} {server.toolCount === 1 ? 'tool' : 'tools'}</Text></Text> : null}
        {blank}
        {actions.map((action, i) => {
          const selected = i === Math.min(index, actions.length - 1);
          return <Text key={action.label}>{pointer(selected)}<Text color={theme.subtle}>{i + 1}. </Text><Text color={selected ? theme.permission : theme.text}>{action.label}</Text></Text>;
        })}
        {blank}
      </OverlayFrame>
    );
  }

  if (view.view === 'tools') {
    return (
      <OverlayFrame title={`Tools for ${server.name}`} hint="↑/↓ to navigate · Enter to select · Esc to back" ruleLabel={ruleLabel}>
        <Text color={theme.subtle}>{tools.length} {tools.length === 1 ? 'tool' : 'tools'}</Text>
        {blank}
        {tools.length === 0 ? <Text color={theme.subtle}>No tools available</Text> : tools.map((tool, i) => {
          const selected = i === Math.min(index, tools.length - 1);
          return <Text key={tool.name} wrap="truncate-end">{pointer(selected)}<Text color={selected ? theme.permission : theme.text}>{tool.name}</Text></Text>;
        })}
        {blank}
      </OverlayFrame>
    );
  }

  const tool = tools.find((t) => t.name === view.tool);
  const params = parameterLines(tool?.inputSchema);
  return (
    <OverlayFrame title={view.tool} hint="Esc to go back" ruleLabel={ruleLabel}>
      <Text color={theme.subtle}>{server.name}</Text>
      {blank}
      <Text><Text bold>Tool name: </Text><Text color={theme.subtle}>{view.tool}</Text></Text>
      <Text><Text bold>Full name: </Text><Text color={theme.subtle}>{tool?.fullName ?? ''}</Text></Text>
      {tool?.description ? <>{blank}<Text bold>Description:</Text><Text wrap="wrap">{tool.description}</Text></> : null}
      {params.length ? (
        <>
          {blank}
          <Text bold>Parameters:</Text>
          {params.map((param) => (
            <Text key={param.name} wrap="wrap">  ● {param.name}{param.required ? <Text color={theme.subtle}> (required)</Text> : null}: <Text color={theme.subtle}>{param.detail}</Text></Text>
          ))}
        </>
      ) : null}
      {blank}
    </OverlayFrame>
  );

  function statusText(status: McpServerStatus): React.ReactNode {
    if (status.status === 'disabled') return <Text><Text color={theme.subtle}>◯</Text> disabled</Text>;
    if (status.status === 'connecting') return <Text><Text color={theme.subtle}>◯</Text> connecting…</Text>;
    if (status.status === 'failed') return <Text><Text color={theme.error}>✘</Text> failed</Text>;
    if (status.capabilities?.includes('tools') && status.toolCount === 0) return <Text><Text color={theme.warning}>⚠</Text> connected · no tools</Text>;
    return <Text><Text color={theme.success}>✔</Text> connected</Text>;
  }
};
