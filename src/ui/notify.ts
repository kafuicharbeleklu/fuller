/**
 * Desktop notifications through the terminal, with Claude Code's channels (preferredNotifChannel):
 * iTerm2 reads OSC 9, Kitty OSC 99, Ghostty OSC 777; any terminal rings the bell. Claude Code's
 * "auto" sends a desktop notification only in those three terminals and nothing elsewhere; Fuller
 * keeps its bell as the fallback, so GNOME Terminal and other VTE terminals still get a signal.
 */
export type NotifChannel = 'auto' | 'iterm2' | 'terminal_bell' | 'iterm2_with_bell' | 'kitty' | 'ghostty' | 'notifications_disabled';
export const NOTIF_CHANNELS: NotifChannel[] = ['auto', 'iterm2', 'terminal_bell', 'iterm2_with_bell', 'kitty', 'ghostty', 'notifications_disabled'];

/** The terminal's own channel, from its environment. */
export function detectChannel(env: NodeJS.ProcessEnv = process.env): 'iterm2' | 'kitty' | 'ghostty' | 'terminal_bell' {
  const program = (env.TERM_PROGRAM ?? '').toLowerCase();
  if (program === 'iterm.app' || env.ITERM_SESSION_ID) return 'iterm2';
  if (program === 'ghostty' || env.GHOSTTY_RESOURCES_DIR) return 'ghostty';
  if (env.KITTY_WINDOW_ID || (env.TERM ?? '') === 'xterm-kitty') return 'kitty';
  return 'terminal_bell';
}

/** Control characters out of a notification text (it sits inside an escape sequence). */
const clean = (text: string) => text.replace(/[\x00-\x1f\x7f;]/g, ' ').slice(0, 200);

/** The bytes to write for a notification, or '' when disabled. */
export function notificationSequence(channel: NotifChannel, title: string, body: string, env: NodeJS.ProcessEnv = process.env): string {
  const resolved = channel === 'auto' ? detectChannel(env) : channel;
  const t = clean(title), b = clean(body);
  switch (resolved) {
    case 'notifications_disabled': return '';
    case 'terminal_bell': return '\x07';
    case 'iterm2': return `\x1b]9;${t}: ${b}\x07`;
    case 'iterm2_with_bell': return `\x1b]9;${t}: ${b}\x07\x07`;
    case 'ghostty': return `\x1b]777;notify;${t};${b}\x07`;
    case 'kitty': return `\x1b]99;i=1:d=0;${t}\x1b\\\x1b]99;i=1:d=1:p=body;${b}\x1b\\`;
  }
}
