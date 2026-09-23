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
  if (typeof p !== 'string' || p.length === 0) throw new PathAccessError('Chemin vide.');
  if (p.includes('\0')) throw new PathAccessError('Chemin invalide.');
  const expanded = p.startsWith('~/') ? path.join(process.env.HOME || '', p.slice(2)) : p;
  const resolved = path.resolve(cwd, expanded);
  const roots = [cwd, ...extraDirs].map((r) => safeRealpath(r));
  const real = safeRealpath(resolved);
  const ok = roots.some((r) => isInside(real, r));
  if (!ok) {
    throw new PathAccessError(
      `Accès refusé : "${p}" est en dehors du répertoire de travail (${cwd}). Utilisez --add-dir pour autoriser d'autres dossiers.`
    );
  }
  return resolved;
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
    throw new PathAccessError(`Lecture refusée : "${p}" est un fichier sensible (secrets, clés, .git).`);
  }
  return resolved;
}

export function assertWritable(p: string, cwd: string, extraDirs: string[] = []): string {
  const resolved = resolveInWorkspace(p, cwd, extraDirs);
  if (isSensitivePath(path.relative(cwd, resolved)) || isSensitivePath(resolved)) {
    throw new PathAccessError(`Écriture refusée : "${p}" est un fichier sensible (secrets, clés, .git).`);
  }
  return resolved;
}

export function displayPath(p: string, cwd: string): string {
  const rel = path.relative(cwd, p);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  const home = process.env.HOME || '';
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}
