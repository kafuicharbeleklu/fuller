#!/usr/bin/env python3
"""Record the real Ink/PTY permission transition with a scripted, inert tool."""
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import struct
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'reports' / 'tui-permission'


def scenario(mode, columns, rows):
    with tempfile.TemporaryDirectory(prefix='fuller-permission-') as directory:
        pid, fd = pty.fork()
        if pid == 0:
            env = dict(os.environ, TERM='xterm-256color', NO_COLOR='1', FULLER_DISABLE_MOUSE='1')
            os.execvpe(str(ROOT / 'node_modules/.bin/tsx'),
                       ['tsx', str(ROOT / 'scripts/tui-permission-fixture.tsx'), directory, mode], env)
        events = []
        raw = bytearray()
        started = time.monotonic()

        def capture(seconds=0.12):
            until = time.monotonic() + seconds
            while time.monotonic() < until:
                if not select.select([fd], [], [], min(0.05, max(0, until - time.monotonic())))[0]:
                    continue
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                raw.extend(chunk)
                events.append([round(time.monotonic() - started, 4), 'o', chunk.decode('utf-8', errors='replace')])

        def wait_for(marker, start=0, timeout=12):
            until = time.monotonic() + timeout
            while marker not in raw[start:]:
                assert time.monotonic() < until, f'{mode}/{columns}x{rows}: missing {marker!r}: {raw[-1400:]!r}'
                capture(0.04)

        try:
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
            wait_for(b'manual mode on')
            capture(0.15)
            phases = {'initial': len(events)}
            os.write(fd, b'please ask permission\r')
            wait_for(b'Waiting for permission')
            capture(0.08)
            phases['waiting'] = len(events)
            wait_for(b'Do you want to proceed?')
            capture(0.12)
            phases['permission'] = len(events)
            os.write(fd, b'\r')
            # Fullscreen folds finished read-only tools into a summary line, like Claude Code.
            wait_for(b'SIMULATED_RESULT_UNIQUE' if mode == 'classic' else b'shell command')
            capture(0.35)
            phases['final'] = len(events)
            OUTPUT.mkdir(parents=True, exist_ok=True)
            header = {'version': 2, 'width': columns, 'height': rows, 'title': f'Fuller permission transition: {mode}/{columns}x{rows}', 'phases': phases}
            (OUTPUT / f'{mode}-{columns}x{rows}.cast').write_text('\n'.join(json.dumps(row, ensure_ascii=False) for row in [header, *events]) + '\n')
            print(f'CAPTURE {mode}/{columns}x{rows}: waiting, permission, result')
        finally:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            os.waitpid(pid, 0)
            os.close(fd)


if __name__ == '__main__':
    for renderer in ('classic', 'fullscreen'):
        for width, height in ((60, 16), (100, 28), (126, 35)):
            scenario(renderer, width, height)
