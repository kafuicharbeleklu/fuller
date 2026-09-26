/** Render a Markdown answer as Fuller's conversation shows it, as a pseudo capture for parity-compare.mjs.
 *
 * FORCE_COLOR=3 npx tsx scripts/render-markdown.tsx <answer.md> <out.json> [columns]
 * Then: node scripts/parity-compare.mjs <claude capture> <out.json> <claude snap> answer --color
 */
import React from 'react';
import fs from 'node:fs';
import { ThemeProvider, loadTheme } from '../src/ui/theme.js';
import { TranscriptItemView } from '../src/ui/Transcript.js';
import { renderToString } from '../src/ui/renderToString.js';

const [docFile, outFile, cols = '100'] = process.argv.slice(2);
const content = fs.readFileSync(docFile, 'utf8').replace(/\n$/, '');
const item = { key: 'a', kind: 'text' as const, messageId: 'm', content, timestamp: Date.now() };
const text = renderToString(<ThemeProvider theme={loadTheme('dark')}><TranscriptItemView item={item} verbose={false} /></ThemeProvider>, Number(cols), 400);
const rows = text.split('\n');
const raw = rows.join('\r\n');
fs.writeFileSync(outFile, JSON.stringify({ target: 'fuller-render', cols: Number(cols), rows: rows.length + 1, raw, events: [{ at: raw.length, snap: 'answer', cols: Number(cols), rows: rows.length + 1 }], work: '' }));
console.log(`${rows.length} rows -> ${outFile}`);
