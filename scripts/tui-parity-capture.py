#!/usr/bin/env python3
"""Record documented TUI interactions through a PTY, without a model request.

Run after npm run build: python3 scripts/tui-parity-capture.py
Writes asciinema v2 recordings and editor exports to reports/tui-parity/.
"""
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
OUTPUT = ROOT / 'reports' / 'tui-parity'


def scenario(mode: str, columns: int) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='fuller-parity-') as directory:
        fixture = Path(directory)
        # Isolate user settings without changing the HOME environment variable.
        preloader = fixture / 'config-root.mjs'
        preloader.write_text("import os from 'node:os';\nos.homedir = () => process.env.FULLER_TEST_CONFIG_ROOT;\n")
        editor = fixture / 'editor.py'
        editor.write_text("#!/usr/bin/env python3\nimport os, pathlib, sys\npathlib.Path(os.environ['FULLER_EDITOR_CAPTURE']).write_text(pathlib.Path(sys.argv[1]).read_text())\n")
        editor.chmod(0o700)
        editor_capture = OUTPUT / f'{mode}-{columns}-editor.txt'
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(fixture)
            env = dict(os.environ, FULLER_TEST_CONFIG_ROOT=str(fixture),
                       FULLER_EDITOR_CAPTURE=str(editor_capture), VISUAL=str(editor),
                       TERM='xterm-256color', NO_COLOR='1')
            os.execvpe('node', ['node', '--import', str(preloader), str(ROOT / 'dist/index.js'),
                               '--key', 'ui_audit_dummy', '--tui', mode], env)
        events = []
        started = time.monotonic()

        def capture(seconds: float = 0.3) -> bytes:
            data = bytearray()
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
                events.append([round(time.monotonic() - started, 4), 'o', chunk.decode('utf-8', errors='replace')])
                data.extend(chunk)
            return bytes(data)

        def send(keys: bytes, seconds: float = 0.3) -> bytes:
            os.write(fd, keys)
            return capture(seconds)

        try:
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 28, columns, 0, 0))
            startup = b''
            for _ in range(30):
                startup += capture(0.2)
                if b'manual mode on' in startup:
                    break
            assert b'manual mode on' in startup, startup[-500:]
            capture()
            running = send(b"!printf 'PARITY_BEFORE\\n'; sleep 1; printf 'PARITY_AFTER\\n'", 0.15)
            running += send(b'\r', 0.2)
            backgrounded = send(b'\x02', 0.35)
            assert b'background' in backgrounded, backgrounded[-500:]
            completed = capture(1.2)
            assert b'completed' in completed, completed[-500:]
            send(b'draft to keep')
            history = send(b'\x12')
            if mode == 'fullscreen':
                assert b'History' in history and b'session' in history, history[-500:]
                send(b'\x1b')
            else:
                assert b'reverse-i-search' in history, history[-500:]
                send(b'\x03')
            viewer = send(b'\x0f')
            assert b'Transcript viewer' in viewer, viewer[-500:]
            if mode == 'fullscreen':
                send(b'v')
                assert 'PARITY_BEFORE' in editor_capture.read_text()
                exported = send(b'[')
                assert b'\x1b[?1049l' in exported and b'PARITY_BEFORE' in exported, exported[-500:]
                restored = send(b'q')
                assert b'\x1b[?1049h' in restored and b'draft to keep' in restored, restored[-500:]
            else:
                send(b'q')
            send(b'\x03')
            send(b'then /con')
            completed_command = send(b'\t')
            assert b'/con' in completed_command, completed_command[-500:]
            send(b'\x03')
            send(b'\x03')
            send(b'\x03', 0.4)
            print(f'PASS {mode} {columns} columns: background Bash, history, transcript, draft, slash completion')
        finally:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            capture(0.1)
            os.waitpid(pid, 0)
            os.close(fd)
            recording = OUTPUT / f'{mode}-{columns}.cast'
            header = {'version': 2, 'width': columns, 'height': 28, 'title': f'Fuller parity — {mode}', 'env': {'TERM': 'xterm-256color'}}
            recording.write_text('\n'.join(json.dumps(item, ensure_ascii=False) for item in [header, *events]) + '\n')


if __name__ == '__main__':
    for renderer in ('classic', 'fullscreen'):
        for width in (60, 100):
            scenario(renderer, width)
