/** Replay a parity-capture.py recording and print one snapshot's screen.
 *
 * node scripts/parity-render.mjs <capture.json> <snap> [--color]
 * --color prefixes each style change with {fg/bg flags}: #rrggbb, p<n> palette, b bold, d dim, i inverse, u underline.
 */
import fs from 'node:fs';
import xterm from '@xterm/headless';

const [file, snapName, ...flags] = process.argv.slice(2);
const capture = JSON.parse(fs.readFileSync(file, 'utf8'));
const snap = capture.events.find((e) => e.snap === snapName);
if (!snap) throw new Error(`no snapshot ${snapName}; have ${capture.events.filter((e) => e.snap).map((e) => e.snap).join(', ')}`);

const terminal = new xterm.Terminal({ cols: capture.cols, rows: capture.rows, allowProposedApi: true, scrollback: 0 });
let offset = 0;
for (const event of capture.events.filter((e) => e.at <= snap.at)) {
  await new Promise((resolve) => terminal.write(capture.raw.slice(offset, event.at), resolve));
  offset = event.at;
  if (!event.snap) terminal.resize(event.cols, event.rows);
}

const color = flags.includes('--color');
const buffer = terminal.buffer.active;
const cell = buffer.getNullCell();
const style = () => {
  const fg = cell.isFgRGB() ? '#' + cell.getFgColor().toString(16).padStart(6, '0') : cell.isFgPalette() ? 'p' + cell.getFgColor() : '';
  const bg = cell.isBgRGB() ? '#' + cell.getBgColor().toString(16).padStart(6, '0') : cell.isBgPalette() ? 'p' + cell.getBgColor() : '';
  return `${fg}${bg ? '/' + bg : ''}${cell.isBold() ? ' b' : ''}${cell.isDim() ? ' d' : ''}${cell.isInverse() ? ' i' : ''}${cell.isUnderline() ? ' u' : ''}`;
};
const lines = [];
for (let y = 0; y < terminal.rows; y++) {
  const line = buffer.getLine(buffer.baseY + y);
  if (!color) { lines.push(line.translateToString(true)); continue; }
  let text = '';
  let previous = '';
  for (let x = 0; x < terminal.cols; x++) {
    line.getCell(x, cell);
    const chars = cell.getChars();
    if (cell.getWidth() === 0) continue;
    const current = style();
    if (chars.trim() && current !== previous) { text += `{${current}}`; previous = current; }
    text += chars || ' ';
  }
  lines.push(text.trimEnd());
}
console.log(lines.join('\n'));
