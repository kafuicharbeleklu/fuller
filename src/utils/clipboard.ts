import { spawn } from 'node:child_process';

/** Copy text to the system clipboard; falls back to OSC 52 (works over SSH / in many terminals). */
export async function copyToClipboard(text: string, stdout: NodeJS.WriteStream = process.stdout): Promise<string> {
  const candidates: Array<[string, string[]]> = process.platform === 'darwin'
    ? [['pbcopy', []]]
    : process.platform === 'win32'
      ? [['clip.exe', []]]
      : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  for (const [cmd, args] of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      try {
        const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
        child.on('error', () => resolve(false));
        child.on('close', (code) => resolve(code === 0));
        child.stdin.on('error', () => {});
        child.stdin.end(text);
      } catch {
        resolve(false);
      }
    });
    if (ok) return cmd;
  }
  if (stdout.isTTY) {
    stdout.write(`\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`);
    return 'OSC 52';
  }
  throw new Error('No clipboard tool found (install wl-clipboard or xclip).');
}
