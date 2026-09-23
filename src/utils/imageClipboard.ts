import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { CONFIG_DIR_NAME } from '../branding.js';

export interface ImageAttachment {
  /** Sequence number shown as [Image #n]. */
  n: number;
  path: string;
  mimeType: string;
  bytes: number;
  name: string;
}

export const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.heic': 'image/heic',
};

export const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

export function imageMimeType(file: string): string | undefined {
  return IMAGE_EXTENSIONS[path.extname(file).toLowerCase()];
}

function run(cmd: string, args: string[], timeoutMs = 4000): Promise<{ ok: boolean; stdout: Buffer }> {
  return new Promise((resolve) => {
    try {
      const chunks: Buffer[] = [];
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
      child.stdout.on('data', (d: Buffer) => chunks.push(d));
      child.on('error', () => { clearTimeout(timer); resolve({ ok: false, stdout: Buffer.alloc(0) }); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, stdout: Buffer.concat(chunks) }); });
    } catch {
      resolve({ ok: false, stdout: Buffer.alloc(0) });
    }
  });
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

export function pasteCacheDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME, 'paste-cache');
}

/**
 * Read an image from the system clipboard (Wayland, X11, macOS, Windows) and
 * save it as a PNG in the paste cache. Returns null when the clipboard holds no image.
 */
export async function readClipboardImage(): Promise<{ path: string; bytes: number } | null> {
  let png: Buffer | null = null;
  if (process.platform === 'darwin') {
    const target = path.join(pasteCacheDir(), `clip-${Date.now()}.png`);
    fs.mkdirSync(pasteCacheDir(), { recursive: true });
    const script = `set f to (POSIX file "${target}")\ntry\n set d to (the clipboard as «class PNGf»)\n set h to open for access f with write permission\n write d to h\n close access h\non error\n error "no image"\nend try`;
    const res = await run('osascript', ['-e', script]);
    if (res.ok && fs.existsSync(target) && fs.statSync(target).size > 0) return { path: target, bytes: fs.statSync(target).size };
    return null;
  }
  if (process.platform === 'win32') {
    const target = path.join(pasteCacheDir(), `clip-${Date.now()}.png`).replace(/\\/g, '\\\\');
    fs.mkdirSync(pasteCacheDir(), { recursive: true });
    const res = await run('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; $i=[Windows.Forms.Clipboard]::GetImage(); if($i){$i.Save('${target}'); 'ok'}`]);
    if (res.ok && fs.existsSync(target.replace(/\\\\/g, '\\')) ) { const p = target.replace(/\\\\/g, '\\'); return { path: p, bytes: fs.statSync(p).size }; }
    return null;
  }
  const attempts: Array<[string, string[]]> = [
    ['wl-paste', ['--type', 'image/png']],
    ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']],
    ['xsel', ['--clipboard', '--output']],
  ];
  for (const [cmd, args] of attempts) {
    const res = await run(cmd, args);
    if (res.ok && res.stdout.length > 8 && res.stdout.subarray(0, 4).equals(PNG_MAGIC)) { png = res.stdout; break; }
  }
  if (!png) return null;
  fs.mkdirSync(pasteCacheDir(), { recursive: true });
  const target = path.join(pasteCacheDir(), `clip-${Date.now()}.png`);
  fs.writeFileSync(target, png);
  return { path: target, bytes: png.length };
}

/** Image file paths mentioned in a prompt (drag & drop inserts absolute paths; @path mentions work too). */
export function findImagePaths(text: string, cwd: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[\s"'@(])((?:~\/|\.{0,2}\/|\/)?[^\s"'()@]+\.(?:png|jpe?g|gif|webp|bmp|heic))\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].replace(/^~\//, `${os.homedir()}/`);
    const full = path.resolve(cwd, raw);
    try {
      if (fs.statSync(full).isFile() && !out.includes(full)) out.push(full);
    } catch {}
  }
  return out;
}

export function attachmentFromFile(file: string, n: number): ImageAttachment {
  const mimeType = imageMimeType(file) ?? 'image/png';
  const bytes = fs.statSync(file).size;
  if (bytes > MAX_IMAGE_BYTES) throw new Error(`Image too large (${Math.round(bytes / 1024 / 1024)} MB > ${MAX_IMAGE_BYTES / 1024 / 1024} MB): ${file}`);
  return { n, path: file, mimeType, bytes, name: path.basename(file) };
}

export function readAttachmentBase64(att: ImageAttachment): string {
  return fs.readFileSync(att.path).toString('base64');
}
