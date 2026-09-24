import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import type { RunInTerminal } from '../tools/nativeTerminal.js';
import type { FrameWriter } from './frameWriter.js';

export const TerminalInputEnabled = createContext(true);

interface Request {
  run: () => Promise<unknown>;
  banner?: string;
  resolve: (value: any) => void;
  reject: (error: unknown) => void;
}

export function useTerminalHandoff(writer: FrameWriter | undefined, fullscreen: boolean, interrupt: () => void) {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef(false);
  const interruptRef = useRef(interrupt);
  interruptRef.current = interrupt;
  const runInTerminal: RunInTerminal = useCallback((run, banner) => new Promise((resolve, reject) => {
    if (!writer || !process.stdin.isTTY || !process.stdout.isTTY) { reject(new Error('Interactive authentication needs a TTY. Run this command in your terminal.')); return; }
    if (pending.current) { reject(new Error('The terminal is already in use.')); return; }
    pending.current = true;
    setRequest({ run, banner, resolve, reject });
  }), [writer]);

  useEffect(() => {
    if (!request || !writer) return;
    let disposed = false;
    const onInterrupt = () => interruptRef.current();
    process.on('SIGINT', onInterrupt);
    // All useRawInput cleanup effects must remove Ink's readable listener before
    // the child starts. In particular no debug-key logging may see passwords.
    const immediate = setImmediate(async () => {
      let resume = () => {};
      let value: unknown;
      let failure: unknown;
      try {
        // Ink uses readable events, which can leave stdin marked paused while
        // Node's TTY watcher still reads. Cycle through flowing mode to emit a
        // real pause event, then let Node stop the watcher on nextTick.
        process.stdin.resume();
        process.stdin.pause();
        await new Promise<void>((resolve) => process.nextTick(resolve));
        if (disposed) throw new Error('Interrupted');
        resume = writer.suspend(fullscreen, request.banner);
        value = await request.run();
      }
      catch (error) { failure = error; }
      finally {
        resume();
        process.off('SIGINT', onInterrupt);
        pending.current = false;
        if (!disposed) setRequest(null);
        // Ink reattaches its readable listener on the next effect pass. Do not
        // resume a flowing stdin here: it could consume input before that pass.
      }
      if (failure) request.reject(failure);
      else request.resolve(value);
    });
    return () => {
      disposed = true;
      clearImmediate(immediate);
      process.off('SIGINT', onInterrupt);
      if (pending.current) {
        interruptRef.current();
        request.reject(new Error('Interrupted'));
      }
    };
  }, [request, writer, fullscreen]);

  return { runInTerminal, terminalActive: request !== null };
}
