import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import xterm from '@xterm/headless';

const directory = new URL('../reports/tui-auth/', import.meta.url);
for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.cast'))) {
  const [header, ...events] = fs.readFileSync(new URL(file, directory), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert(Number.isInteger(header.fuller_verification_events), `${file}: regenerate this capture`);
  const raw = events.slice(0, header.fuller_verification_events).filter((event) => event[1] === 'o').map((event) => event[2]).join('');
  assert(!raw.includes('\x1b[6n'), `${file}: unsolicited CPR`);
  assert(!raw.includes('fake-auth-secret-ONLY-FOR-TEST'), `${file}: password echoed`);
  const terminal = new xterm.Terminal({ cols: header.width, rows: header.height, scrollback: 10000, allowProposedApi: true });
  await new Promise((resolve) => terminal.write(raw, resolve));
  const buffer = terminal.buffer.active;
  const screen = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i).translateToString(true)).join('\n').trimEnd();
  terminal.dispose();
  assert.equal((screen.match(/^❯(?: |$)/gm) ?? []).length, 1, `${file}: prompt count`);
  assert(!/Waiting for permission|esc to interrupt|Running…/.test(screen), `${file}: stale live state: ${screen.split('\n').filter((line) => /Waiting for permission|esc to interrupt|Running…/.test(line)).join(' / ')}`);
  if (file.endsWith('-success.cast')) assert.equal((screen.match(/AUTH_RESULT_UNIQUE/g) ?? []).length, 1, `${file}: result count`);
  fs.writeFileSync(new URL(path.basename(file, '.cast') + '.txt', directory), screen + '\n');
  console.log(`PASS ${file}: terminal replay, single prompt, no stale activity`);
}
