/** Replay scripted PTY permissions, including transient frames and scrollback. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import xterm from '@xterm/headless';

const directory = new URL('../reports/tui-permission/', import.meta.url);
for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.cast'))) {
  const [header, ...events] = fs.readFileSync(new URL(file, directory), 'utf8').trim().split('\n').map(JSON.parse);
  const raw = events.filter((event) => event[1] === 'o').map((event) => event[2]).join('');
  assert(!raw.includes('\x1b[6n'), `${file}: unsolicited CPR`);
  const afterInitial = events.slice(header.phases.initial).filter((event) => event[1] === 'o').map((event) => event[2]).join('');
  assert(!afterInitial.includes('\x1b[2J'), `${file}: full-screen clear during permission`);

  async function screen(phase) {
    const terminal = new xterm.Terminal({ cols: header.width, rows: header.height, scrollback: 10000, allowProposedApi: true, convertEol: true });
    const prefix = events.slice(0, header.phases[phase]).filter((event) => event[1] === 'o').map((event) => event[2]).join('');
    await new Promise((resolve) => terminal.write(prefix, resolve));
    const buffer = terminal.buffer.active;
    const text = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i).translateToString(true)).join('\n').trimEnd();
    terminal.dispose();
    return text;
  }

  const waiting = await screen('waiting');
  const permission = await screen('permission');
  const final = await screen('final');
  assert(!/^❯\s*$/m.test(waiting), `${file}: orphan empty composer while waiting`);
  assert(permission.includes('Bash command') && permission.includes('sudo ip link set tun0 down'), `${file}: incomplete permission card`);
  assert(!/^❯\s*$/m.test(permission), `${file}: orphan empty composer under permission`);
  assert(!/Bash command|Waiting for permission|Do you want to proceed\?|confirming/.test(final), `${file}: stale permission frame`);
  if (file.startsWith('fullscreen')) {
    // Fullscreen shows finished tools as one summary line (Claude Code), without their output.
    assert.equal((final.match(/Ran 1 shell command/g) ?? []).length, 1, `${file}: tool summary count`);
  } else {
    assert.equal((final.match(/SIMULATED_RESULT_UNIQUE/g) ?? []).length, 1, `${file}: result count`);
  }
  assert.equal((final.match(/^❯\s*$/gm) ?? []).length, 1, `${file}: final composer count`);
  fs.writeFileSync(new URL(file.replace(/\.cast$/, '.permission.txt'), directory), permission + '\n');
  fs.writeFileSync(new URL(file.replace(/\.cast$/, '.txt'), directory), final + '\n');
  console.log(`PASS ${file}: no empty composer during permission, one final result`);
}
