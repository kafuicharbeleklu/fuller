import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('App hooks', () => {
  it('declares every hook before the startup session picker returns', () => {
    // An early return before a hook makes React throw "Rendered more hooks than during the previous render"
    // when `fuller --resume` switches from the picker to the conversation.
    const source = fs.readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8');
    const early = source.indexOf("if (screen === 'picker')");
    const after = source.slice(early);
    expect(early).toBeGreaterThan(0);
    expect(after).not.toMatch(/\buse(State|Effect|Memo|Callback|Ref|Stdout|Input)\(/);
  });
});
