import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findImagePaths, attachmentFromFile, imageMimeType } from '../src/utils/imageClipboard.js';

describe('image attachments', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fuller-img-'));
  afterAll(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  fs.mkdirSync(path.join(cwd, 'shots'));
  fs.writeFileSync(path.join(cwd, 'shots', 'a.png'), png);
  fs.writeFileSync(path.join(cwd, 'b.JPG'), png);

  it('finds existing image paths in a prompt (relative, absolute, @mention) and ignores missing ones', () => {
    const abs = path.join(cwd, 'b.JPG');
    const found = findImagePaths(`look at shots/a.png and @${abs} and nope.png please`, cwd);
    expect(found).toEqual([path.join(cwd, 'shots', 'a.png'), abs]);
  });
  it('builds attachment metadata with mime types', () => {
    const att = attachmentFromFile(path.join(cwd, 'b.JPG'), 1);
    expect(att).toMatchObject({ n: 1, mimeType: 'image/jpeg', bytes: png.length, name: 'b.JPG' });
    expect(imageMimeType('x.webp')).toBe('image/webp');
    expect(imageMimeType('x.txt')).toBeUndefined();
  });
});
