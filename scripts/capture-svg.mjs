/** Turn one snapshot of a parity-capture.py recording into an SVG terminal picture (README screenshot).
 *
 * node scripts/capture-svg.mjs <capture.json> <snap> <out.svg> [--rows N]
 * Colours come from the recorded escape sequences; palette colours use a dark xterm palette.
 */
import fs from 'node:fs';
import xterm from '@xterm/headless';

const [file, snapName, out, ...flags] = process.argv.slice(2);
if (!file || !snapName || !out) throw new Error('usage: capture-svg.mjs <capture.json> <snap> <out.svg> [--rows N]');
const capture = JSON.parse(fs.readFileSync(file, 'utf8'));
const snap = capture.events.find((e) => e.snap === snapName);
if (!snap) throw new Error(`no snapshot ${snapName}`);
const terminal = new xterm.Terminal({ cols: capture.cols, rows: capture.rows, allowProposedApi: true, scrollback: 0 });
let offset = 0;
for (const event of capture.events.filter((e) => e.at <= snap.at)) {
  await new Promise((resolve) => terminal.write(capture.raw.slice(offset, event.at), resolve));
  offset = event.at;
  if (!event.snap) terminal.resize(event.cols, event.rows);
}

const PALETTE = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
  '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff'];
const BACKGROUND = '#1e1e1e';
const FOREGROUND = '#e5e5e5';
const CELL_W = 8.4, CELL_H = 18, PAD = 16, BAR = 28;
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const color = (rgb, palette, value) => (rgb ? `#${value.toString(16).padStart(6, '0')}` : palette ? PALETTE[value] ?? FOREGROUND : null);

const buffer = terminal.buffer.active;
const cell = buffer.getNullCell();
// Drop blank rows at the bottom, then keep at most --rows rows.
const maxRows = Number(flags[flags.indexOf('--rows') + 1]) || terminal.rows;
let last = terminal.rows - 1;
while (last > 0 && !buffer.getLine(buffer.baseY + last).translateToString(true).trim()) last--;
const rows = Math.min(maxRows, last + 1);
const width = Math.ceil(capture.cols * CELL_W + PAD * 2);
const height = Math.ceil(rows * CELL_H + PAD * 2 + BAR);
const parts = [];
for (let y = 0; y < rows; y++) {
  const line = buffer.getLine(buffer.baseY + y);
  const top = BAR + PAD + y * CELL_H;
  let x = 0;
  while (x < terminal.cols) {
    line.getCell(x, cell);
    const inverse = cell.isInverse();
    let fg = color(cell.isFgRGB(), cell.isFgPalette(), cell.getFgColor()) ?? FOREGROUND;
    let bg = color(cell.isBgRGB(), cell.isBgPalette(), cell.getBgColor());
    if (inverse) [fg, bg] = [bg ?? BACKGROUND, fg];
    const bold = cell.isBold(), dim = cell.isDim(), underline = cell.isUnderline();
    // Extend the run while the style stays the same.
    let text = '';
    let end = x;
    for (; end < terminal.cols; end++) {
      line.getCell(end, cell);
      const inv = cell.isInverse();
      let f = color(cell.isFgRGB(), cell.isFgPalette(), cell.getFgColor()) ?? FOREGROUND;
      let b = color(cell.isBgRGB(), cell.isBgPalette(), cell.getBgColor());
      if (inv) [f, b] = [b ?? BACKGROUND, f];
      if (f !== fg || b !== bg || cell.isBold() !== bold || cell.isDim() !== dim || cell.isUnderline() !== underline) break;
      if (cell.getWidth() === 0) continue;
      text += cell.getChars() || ' ';
    }
    const left = PAD + x * CELL_W;
    if (bg) parts.push(`<rect x="${left.toFixed(1)}" y="${top}" width="${((end - x) * CELL_W).toFixed(1)}" height="${CELL_H}" fill="${bg}"/>`);
    if (text.trim()) {
      const attrs = [`x="${left.toFixed(1)}"`, `y="${top + 13}"`, `fill="${fg}"`];
      if (bold) attrs.push('font-weight="bold"');
      if (dim) attrs.push('opacity="0.6"');
      if (underline) attrs.push('text-decoration="underline"');
      parts.push(`<text ${attrs.join(' ')} textLength="${((end - x) * CELL_W).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${escape(text)}</text>`);
    }
    x = end;
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'DejaVu Sans Mono', 'Menlo', 'Consolas', monospace" font-size="14" xml:space="preserve">
<rect width="${width}" height="${height}" rx="8" fill="${BACKGROUND}"/>
<circle cx="18" cy="15" r="6" fill="#ff5f56"/><circle cx="38" cy="15" r="6" fill="#ffbd2e"/><circle cx="58" cy="15" r="6" fill="#27c93f"/>
${parts.join('\n')}
</svg>
`;
fs.writeFileSync(out, svg);
console.log(`${out}: ${capture.cols}×${rows}, ${parts.length} elements`);
