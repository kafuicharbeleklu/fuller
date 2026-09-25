import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveInWorkspace, assertReadable, isSensitivePath, PathAccessError } from '../src/tools/paths.js';

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-paths-'));
fs.mkdirSync(path.join(cwd, 'src'));
fs.writeFileSync(path.join(cwd, 'src', 'a.ts'), 'x');
afterAll(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe('resolveInWorkspace', () => {
  it('accepts paths inside the workspace', () => {
    expect(resolveInWorkspace('src/a.ts', cwd)).toBe(path.join(cwd, 'src', 'a.ts'));
    expect(resolveInWorkspace('.', cwd)).toBe(cwd);
  });
  it('rejects escapes', () => {
    expect(() => resolveInWorkspace('../../etc/passwd', cwd)).toThrow(PathAccessError);
    expect(() => resolveInWorkspace('/etc/passwd', cwd)).toThrow(PathAccessError);
    expect(() => resolveInWorkspace('~/.ssh/id_rsa', cwd)).toThrow(PathAccessError);
  });
  it('allows additional directories', () => {
    const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-extra-'));
    try {
      expect(resolveInWorkspace(path.join(extra, 'x'), cwd, [extra])).toBe(path.join(extra, 'x'));
    } finally {
      fs.rmSync(extra, { recursive: true, force: true });
    }
  });
  it('follows symlinks that escape', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-out-'));
    try {
      fs.writeFileSync(path.join(outside, 'secret'), 's');
      fs.symlinkSync(outside, path.join(cwd, 'link'));
      expect(() => resolveInWorkspace('link/secret', cwd)).toThrow(PathAccessError);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('sensitive files', () => {
  it('detects secrets', () => {
    for (const p of ['.env', '.env.local', 'config/.env', '.git/config', 'id_rsa', 'keys/server.pem', '.aws/credentials']) expect(isSensitivePath(p), p).toBe(true);
    for (const p of ['src/env.ts', 'environment.md', 'gitlog.txt']) expect(isSensitivePath(p), p).toBe(false);
  });
  it('refuses to read them', () => {
    fs.writeFileSync(path.join(cwd, '.env'), 'KEY=1');
    expect(() => assertReadable('.env', cwd)).toThrow(/sensitive file/);
  });
});
