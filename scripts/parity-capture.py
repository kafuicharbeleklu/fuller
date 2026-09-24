#!/usr/bin/env python3
"""Drive Claude Code or Fuller through a PTY and record named screen snapshots.

Usage:
  python3 scripts/parity-capture.py <claude|fuller>[:args] <cols>x<rows> <out.json> [step ...]
  (e.g. fuller:--tui fullscreen, claude:--permission-mode default)

Steps run in order:
  until:TEXT   wait (max 60 s) until TEXT appears in the output
  wait:SEC     read output for SEC seconds
  key:SEQ      send SEQ (Python escapes, e.g. key:\\r, key:\\x1b[B), then read 0.6 s
  tap:SEQ      same as key, but read only 0.1 s (double taps such as Esc Esc)
  resize:CxR   resize the terminal
  snap:NAME    record the current output offset under NAME
  signal:NAME  send a signal to the process (e.g. signal:CONT after a ctrl+z suspend)
  file:PATH    (before start) create PATH in the working directory, e.g. file:CLAUDE.md
  git          (before start) run git init in the working directory

Each run starts in a fresh temporary directory. Claude Code is started without
the CLAUDE* variables of an enclosing session, so it behaves like a user shell.
Fuller uses an isolated config root and a dummy API key (PARITY_KEEP_KEY=1 keeps
the real one, for model listing): no model request.
Render the result with: node scripts/parity-render.mjs <out.json> <snap> [--color]
"""
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import tempfile
import termios
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    spec, size, out, *steps = sys.argv[1:]
    target, _, extra = spec.partition(':')
    cols, rows = (int(v) for v in size.split('x'))
    # PARITY_WORKDIR reuses a directory, e.g. to resume a session created by a previous run.
    work = Path(os.environ['PARITY_WORKDIR']) if os.environ.get('PARITY_WORKDIR') else Path(tempfile.mkdtemp(prefix='parity-'))
    work.mkdir(parents=True, exist_ok=True)
    (work / 'README.md').write_text('# demo\n')
    for step in [s for s in steps if s.startswith('file:') or s == 'git']:
        if step == 'git':
            os.system(f'git -C {work} init -q && git -C {work} add -A && git -C {work} -c user.name=p -c user.email=p@p commit -qm init')
        else:
            (work / step[5:]).parent.mkdir(parents=True, exist_ok=True)
            (work / step[5:]).write_text('# Project notes\n')
    steps = [s for s in steps if not (s.startswith('file:') or s == 'git')]
    env = {k: v for k, v in os.environ.items() if not k.startswith('CLAUDE') and k != 'CLAUDECODE'}
    env.update(TERM='xterm-256color', COLORTERM='truecolor')
    if target == 'claude':
        argv = ['claude', *extra.split()]
    else:
        preloader = work / '.config-root.mjs'
        preloader.write_text("import os from 'node:os';\nos.homedir = () => process.env.FULLER_TEST_CONFIG_ROOT;\n")
        env.update(FULLER_TEST_CONFIG_ROOT=str(work))
        # PARITY_KEEP_KEY=1 keeps the caller's GEMINI_API_KEY (e.g. to list models in /model).
        if not (os.environ.get('PARITY_KEEP_KEY') and env.get('GEMINI_API_KEY')):
            env['GEMINI_API_KEY'] = 'parity_dummy_key'
        argv = ['node', '--import', str(preloader), str(ROOT / 'dist/index.js'), *extra.split()]

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(work)
        os.execvpe(argv[0], argv, env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    chunks: list[str] = []
    events: list[dict] = []
    size_now = [cols, rows]

    def pump(seconds: float) -> None:
        end = time.time() + seconds
        while time.time() < end:
            if not select.select([fd], [], [], 0.05)[0]:
                continue
            try:
                data = os.read(fd, 65536)
            except OSError:
                return
            if b'\x1b[6n' in data:
                os.write(fd, f'\x1b[{size_now[1]};1R'.encode())
            chunks.append(data.decode('utf-8', 'replace'))

    pump(1.0)
    for step in steps:
        kind, _, arg = step.partition(':')
        if kind == 'until':
            end = time.time() + 60
            while arg not in ''.join(chunks)[-40000:] and time.time() < end:
                pump(0.25)
            pump(0.5)
        elif kind == 'wait':
            pump(float(arg))
        elif kind in ('key', 'tap'):
            os.write(fd, arg.encode().decode('unicode_escape').encode('latin-1'))
            pump(0.6 if kind == 'key' else 0.1)
        elif kind == 'resize':
            c, r = (int(v) for v in arg.split('x'))
            size_now[:] = [c, r]
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
            events.append({'at': len(''.join(chunks)), 'cols': c, 'rows': r})
            pump(0.8)
        elif kind == 'signal':
            os.kill(pid, getattr(signal, f'SIG{arg}'))
            pump(1.0)
        elif kind == 'snap':
            events.append({'at': len(''.join(chunks)), 'snap': arg, 'cols': size_now[0], 'rows': size_now[1]})
    for key in (b'\x03', b'\x03', b'\x04'):
        try:
            os.write(fd, key)
        except OSError:
            break
        pump(0.4)
    try:
        os.kill(pid, 9)
    except ProcessLookupError:
        pass
    Path(out).write_text(json.dumps({'target': spec, 'cols': cols, 'rows': rows, 'raw': ''.join(chunks), 'events': events, 'work': str(work)}))
    print(f'{spec} {cols}x{rows}: {", ".join(e["snap"] for e in events if "snap" in e)} -> {out}')


if __name__ == '__main__':
    main()
