import React from 'react';
import { render } from 'ink';

/**
 * Render an Ink element to a plain string (ANSI kept) at a given width, using a
 * throwaway Ink instance with a fake stdout. Used to re-lay out the visible tail
 * of the transcript after a terminal resize. Synchronous: Ink 5 commits legacy
 * roots synchronously, and in debug mode it writes the full static output on
 * every render, so the last write holds everything exactly once.
 */
export function renderToString(element: React.ReactElement, columns: number, rows = 40): string {
  const writes: string[] = [];
  const stdout = {
    columns,
    rows,
    isTTY: false,
    write(chunk: string) { writes.push(String(chunk)); return true; },
    on() { return this; }, off() { return this; }, once() { return this; }, removeListener() { return this; }, emit() { return false; },
  } as unknown as NodeJS.WriteStream;
  const stdin = {
    isTTY: false,
    on() { return this; }, off() { return this; }, once() { return this; }, removeListener() { return this; },
    setRawMode() { return this; }, setEncoding() { return this; }, ref() { return this; }, unref() { return this; },
    read() { return null; }, resume() { return this; }, pause() { return this; },
  } as unknown as NodeJS.ReadStream;
  const instance = render(element, { stdout, stdin, stderr: stdout, debug: true, exitOnCtrlC: false, patchConsole: false });
  try {
    instance.unmount();
  } catch {}
  const last = writes[writes.length - 1] ?? '';
  return last.replace(/\n+$/, '');
}
