import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { CONFIG_DIR_NAME } from '../branding.js';

export interface Checkpoint {
  id: string;
  timestamp: number;
  description: string;
  messageId?: string;
  files: Array<{ filePath: string; originalContent: string | null }>;
}

const RETENTION_MS = 30 * 24 * 3600 * 1000;

/** Snapshots files before the agent modifies them so that `/rewind` can restore them. */
export class CheckpointManager {
  private checkpointsDir: string;
  private checkpointsFile: string;
  private workspaceDir: string;
  private cache: Checkpoint[] | null = null;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
    const hash = crypto.createHash('sha1').update(workspaceDir).digest('hex').slice(0, 16);
    this.checkpointsDir = path.join(os.homedir(), CONFIG_DIR_NAME, 'checkpoints', hash);
    this.checkpointsFile = path.join(this.checkpointsDir, 'checkpoints.json');
    fs.mkdirSync(this.checkpointsDir, { recursive: true });
    this.purge();
  }

  private load(): Checkpoint[] {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(fs.readFileSync(this.checkpointsFile, 'utf8'));
    } catch {
      this.cache = [];
    }
    return this.cache!;
  }

  private save(checkpoints: Checkpoint[]) {
    this.cache = checkpoints;
    fs.writeFileSync(this.checkpointsFile, JSON.stringify(checkpoints), 'utf8');
  }

  /** Remove checkpoints older than 30 days. */
  public purge(): void {
    const all = this.load();
    const kept = all.filter((c) => Date.now() - c.timestamp < RETENTION_MS);
    if (kept.length !== all.length) this.save(kept);
  }

  public createCheckpoint(description: string, absolutePaths: string[], messageId?: string): Checkpoint {
    const files = absolutePaths.map((full) => {
      let content: string | null = null;
      try {
        if (fs.existsSync(full)) content = fs.readFileSync(full, 'utf8');
      } catch {}
      return { filePath: path.relative(this.workspaceDir, full), originalContent: content };
    });
    const checkpoint: Checkpoint = {
      id: Math.random().toString(36).slice(2, 10),
      timestamp: Date.now(),
      description,
      messageId,
      files,
    };
    const checkpoints = this.load();
    checkpoints.unshift(checkpoint);
    this.save(checkpoints.slice(0, 500));
    return checkpoint;
  }

  public getCheckpoints(): Checkpoint[] {
    return [...this.load()].sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Restore every file touched since (and including) the given checkpoint. Returns restored paths. */
  public rewindTo(checkpointId: string): string[] {
    const checkpoints = this.load();
    const idx = checkpoints.findIndex((c) => c.id === checkpointId);
    if (idx === -1) throw new Error(`Checkpoint ${checkpointId} not found`);
    const restored = new Set<string>();
    for (let i = 0; i <= idx; i++) {
      for (const f of checkpoints[i].files) {
        const full = path.resolve(this.workspaceDir, f.filePath);
        if (f.originalContent === null) {
          if (fs.existsSync(full)) fs.unlinkSync(full);
        } else {
          fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, f.originalContent, 'utf8');
        }
        restored.add(f.filePath);
      }
    }
    this.save(checkpoints.slice(idx + 1));
    return Array.from(restored);
  }

  public rewindLast(): string[] | null {
    const checkpoints = this.load();
    if (checkpoints.length === 0) return null;
    return this.rewindTo(checkpoints[0].id);
  }

  public clear(): void {
    this.save([]);
  }
}
