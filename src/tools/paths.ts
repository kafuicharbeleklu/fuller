import fs from 'node:fs';
import path from 'node:path';

export class PathAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathAccessError';
  }
}

const SENSITIVE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.[^/]+)?$/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.netrc$/,
  /(^|\/)\.docker\/config\.json$/,
  /(^|\/)\.gnupg(\/|$)/,
];

export function isSensitivePath(p: string): boolean {
  const normalized = p.split(path.sep).join('/');
  return SENSITIVE_PATTERNS.some((re) => re.test(normalized));
}

function isInside(target: string, root: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve a user/model supplied path and make sure it stays inside the
 * workspace (or one of the additional directories). Symlinks are resolved
 * for the existing part of the path so that a link cannot escape the sandbox.
 */
export function resolveInWorkspace(p: string, cwd: string, extraDirs: string[] = []): string {
  if (typeof p !== 'string' || p.length === 0) throw new PathAccessError('Empty path.');
  if (p.includes('\0')) throw new PathAccessError('Invalid path.');
  const resolved = expandPath(p, cwd);
  if (!insideRoots(resolved, cwd, extraDirs)) {
    throw new PathAccessError(
      `Access denied: "${p}" is outside the working directory (${cwd}) and the directories added with /add-dir.`
    );
  }
  return resolved;
}

function expandPath(p: string, cwd: string): string {
  const expanded = p === '~' ? process.env.HOME || '' : p.startsWith('~/') ? path.join(process.env.HOME || '', p.slice(2)) : p;
  return path.resolve(cwd, expanded);
}

function insideRoots(resolved: string, cwd: string, extraDirs: string[]): boolean {
  const real = safeRealpath(resolved);
  return [cwd, ...extraDirs].map((r) => safeRealpath(r)).some((r) => isInside(real, r));
}

/**
 * The absolute path when `p` lies outside the workspace and its added directories (symlinks
 * resolved, like resolveInWorkspace), so the user can be asked; undefined inside, and for a
 * sensitive file, which stays refused whatever the answer.
 */
export function outsidePath(p: unknown, cwd: string, extraDirs: string[] = []): string | undefined {
  if (typeof p !== 'string' || !p || p.includes('\0')) return undefined;
  const resolved = expandPath(p, cwd);
  if (insideRoots(resolved, cwd, extraDirs)) return undefined;
  // The real location: a link inside the project that points elsewhere is asked about as that place.
  const real = safeRealpath(resolved);
  if (isSensitivePath(resolved) || isSensitivePath(real)) return undefined;
  return real;
}

/** realpath of the deepest existing ancestor, joined with the remaining segments. */
export function safeRealpath(p: string): string {
  let current = p;
  const tail: string[] = [];
  for (let i = 0; i < 64; i++) {
    try {
      const real = fs.realpathSync(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return p;
      tail.push(path.basename(current));
      current = parent;
    }
  }
  return p;
}

export function assertReadable(p: string, cwd: string, extraDirs: string[] = []): string {
  const resolved = resolveInWorkspace(p, cwd, extraDirs);
  if (isSensitivePath(path.relative(cwd, resolved)) || isSensitivePath(resolved)) {
    throw new PathAccessError(`Read refused: "${p}" is a sensitive file (secrets, keys, .git).`);
  }
  return resolved;
}

export function assertWritable(p: string, cwd: string, extraDirs: string[] = []): string {
  const resolved = resolveInWorkspace(p, cwd, extraDirs);
  if (isSensitivePath(path.relative(cwd, resolved)) || isSensitivePath(resolved)) {
    throw new PathAccessError(`Write refused: "${p}" is a sensitive file (secrets, keys, .git).`);
  }
  return resolved;
}

export function displayPath(p: string, cwd: string): string {
  const rel = path.relative(cwd, p);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  const home = process.env.HOME || '';
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}
