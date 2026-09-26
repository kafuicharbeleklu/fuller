/** Compare the same screen captured in Claude Code and in Fuller (parity-capture.py recordings).
 *
 * node scripts/parity-compare.mjs <claude.json> <fuller.json> <snap> [<fuller snap>] [--color] [--all]
 *
 * Both screens are replayed in a headless xterm, then normalized so that expected differences do not
 * count: the product name, the model, the version, the working directory. Rows are aligned from the
 * top of the first non-empty row; each differing row is printed as `C|` (Claude Code) and `F|` (Fuller).
 * --color compares the styles too ({fg/bg flags} before each change, as parity-render.mjs prints them).
 * --all prints every row, the equal ones prefixed with `=|`.
 */
import fs from 'node:fs';
import xterm from '@xterm/headless';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [claudeFile, fullerFile, snap, fullerSnap = snap] = args.filter((a) => !a.startsWith('--'));
const color = flags.has('--color');

export async function screen(file, snapName, withColor) {
  const capture = JSON.parse(fs.readFileSync(file, 'utf8'));
  const target = capture.events.find((e) => e.snap === snapName);
  if (!target) throw new Error(`${file}: no snapshot ${snapName}; have ${capture.events.filter((e) => e.snap).map((e) => e.snap).join(', ')}`);
  const terminal = new xterm.Terminal({ cols: capture.cols, rows: capture.rows, allowProposedApi: true, scrollback: 0 });
  let offset = 0;
  for (const event of capture.events.filter((e) => e.at <= target.at)) {
    await new Promise((resolve) => terminal.write(capture.raw.slice(offset, event.at), resolve));
    offset = event.at;
    if (!event.snap) terminal.resize(event.cols, event.rows);
  }
  const buffer = terminal.buffer.active;
  const cell = buffer.getNullCell();
  const style = () => {
    const fg = cell.isFgRGB() ? '#' + cell.getFgColor().toString(16).padStart(6, '0') : cell.isFgPalette() ? 'p' + cell.getFgColor() : '';
    const bg = cell.isBgRGB() ? '#' + cell.getBgColor().toString(16).padStart(6, '0') : cell.isBgPalette() ? 'p' + cell.getBgColor() : '';
    return `${fg}${bg ? '/' + bg : ''}${cell.isBold() ? ' b' : ''}${cell.isDim() ? ' d' : ''}${cell.isInverse() ? ' i' : ''}${cell.isUnderline() ? ' u' : ''}`;
  };
  const rows = [];
  for (let y = 0; y < terminal.rows; y++) {
    const line = buffer.getLine(buffer.baseY + y);
    if (!withColor) { rows.push(line.translateToString(true)); continue; }
    let text = '';
    let previous = '';
    for (let x = 0; x < terminal.cols; x++) {
      line.getCell(x, cell);
      if (cell.getWidth() === 0) continue;
      const chars = cell.getChars();
      const current = style();
      if (chars.trim() && current !== previous) { text += `{${current}}`; previous = current; }
      text += chars || ' ';
    }
    rows.push(text.trimEnd());
  }
  return { rows, work: capture.work };
}

/** Expected differences out: names, models, versions, paths, the logo. */
export function normalize(row, work) {
  let out = row;
  if (work) out = out.split(work).join('<work>');
  return out
    .replace(/\/tmp\/parity-[\w-]+/g, '<work>')
    .replace(/Claude Code|Fuller/g, '<app>')
    .replace(/\bClaude\b/g, '<app>')
    .replace(/v\d+\.\d+\.\d+/g, 'v<version>')
    .replace(/(Haiku|Sonnet|Opus) [\d.]+(?: \([^)]*\))?|Gemini [\d.]+(?: Flash(?: Lite)?| Pro)?(?: \([^)]*\))?/g, '<model>')
    .replace(/Claude Max|Claude Pro|Gemini API/g, '<plan>')
    .replace(/[▐▛▜▝▘▙▟█╗╔╝╚║═]+/g, '<logo>')
    .replace(/\s+$/, '');
}

if (claudeFile && fullerFile && snap) {
  const c = await screen(claudeFile, snap, color);
  const f = await screen(fullerFile, fullerSnap, color);
  const cn = c.rows.map((r) => normalize(r, c.work));
  const fn = f.rows.map((r) => normalize(r, f.work));
  const count = Math.max(cn.length, fn.length);
  let differing = 0;
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = cn[i] ?? '';
    const b = fn[i] ?? '';
    if (a === b) { if (flags.has('--all')) out.push(`=|${String(i).padStart(2)}| ${a}`); continue; }
    differing++;
    out.push(`C|${String(i).padStart(2)}| ${a}`);
    out.push(`F|${String(i).padStart(2)}| ${b}`);
  }
  console.log(out.join('\n'));
  console.log(`\n${snap}: ${differing} of ${count} rows differ${color ? ' (with styles)' : ''}`);
}
