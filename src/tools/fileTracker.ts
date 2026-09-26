import fs from 'node:fs';
import { safeRealpath } from './paths.js';

/**
 * Claude Code's edit guard: an existing file may only be edited or overwritten
 * after the agent has read it, and not if it changed since (the user, a
 * formatter or a command touched it). Otherwise the model edits from memory
 * or silently overwrites someone else's changes.
 */
export class FileTracker {
  private readonly seen = new Map<string, number>();
  /** Partial reads (offset/limit) per file this session: a medium file sliced twice is read whole. */
  private readonly slices = new Map<string, number>();

  recordPartial(fullPath: string): void {
    const key = safeRealpath(fullPath);
    this.slices.set(key, (this.slices.get(key) ?? 0) + 1);
  }

  partialReads(fullPath: string): number {
    return this.slices.get(safeRealpath(fullPath)) ?? 0;
  }

  private mtime(fullPath: string): number | undefined {
    try { return fs.statSync(fullPath).mtimeMs; } catch { return undefined; }
  }

  /** After a read, or after the agent's own write (its version is known). */
  record(fullPath: string): void {
    const mtime = this.mtime(fullPath);
    if (mtime !== undefined) this.seen.set(safeRealpath(fullPath), mtime);
  }

  /** Why the agent may not write this file now, or null. New files are fine. */
  check(fullPath: string): string | null {
    const mtime = this.mtime(fullPath);
    if (mtime === undefined) return null;
    const known = this.seen.get(safeRealpath(fullPath));
    if (known === undefined) return 'File has not been read yet. Read it first before writing to it.';
    if (known !== mtime) return 'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.';
    return null;
  }
}
