#!/usr/bin/env python3
"""Exercise native terminal ownership using a fake sudo; no privileges or API calls.

Run after npm run build. Writes asciinema recordings under reports/tui-auth/.
"""
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import struct
import sys
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'reports' / 'tui-auth'


def scenario(mode, action):
    with tempfile.TemporaryDirectory(prefix='fuller-auth-') as directory:
        fixture = Path(directory)
        fake = fixture / 'sudo'
        fake.write_text('''#!/usr/bin/env python3
import getpass, os, sys, time
secret = getpass.getpass('SIMULATED_PASSWORD: ')
if not secret:
    sys.exit(2)
if 'cancel' in sys.argv or 'timeout' in sys.argv:
    with open('/dev/tty', 'w') as tty:
        tty.write('SIMULATED_WAITING\\n')
        tty.flush()
    time.sleep(60)
print('AUTH_RESULT_UNIQUE')
''')
        fake.chmod(0o700)
        preloader = fixture / 'config-root.mjs'
        preloader.write_text("import os from 'node:os';\nos.homedir = () => process.env.FULLER_TEST_CONFIG_ROOT;\n")
        # See src/config.ts: project settings are applied after user settings.
        settings = fixture / '.fuller' / 'settings.json'
        settings.parent.mkdir()
        # The dummy key cannot answer, so no model reply after the `!` command.
        settings.write_text(json.dumps({'bashTimeoutMs': 3000 if action.startswith('timeout') else 15000, 'notifications': 'off', 'replyAfterShell': False}))
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(fixture)
            env = dict(os.environ, FULLER_TEST_CONFIG_ROOT=str(fixture),
                       PATH=str(fixture) + os.pathsep + os.environ['PATH'],
                       FULLER_DEBUG_KEYS=str(fixture / 'keys.log'),
                       FULLER_DEBUG_FRAMES=str(fixture / 'frames.log'),
                       TERM='xterm-256color', NO_COLOR='1')
            os.execvpe('node', ['node', '--import', str(preloader), str(ROOT / 'dist/index.js'),
                               '--key', 'ui_audit_dummy', '--tui', mode], env)
        events = []
        raw = bytearray()
        started = time.monotonic()

        def capture(seconds=0.15):
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
                assert time.monotonic() < until, f'{mode}/{action}: missing {marker!r}: {raw[-1600:]!r}'
                capture()

        try:
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 28, 100, 0, 0))
            wait_for(b'manual mode on')
            os.write(fd, f'!sudo fuller-auth-test {action}'.encode())
            capture(0.3)
            os.write(fd, b'\r')
            wait_for(b'SIMULATED_PASSWORD:')
            secret = b'fake-auth-secret-ONLY-FOR-TEST'
            if action == 'cancel_prompt':
                os.write(fd, b'\x03')
            elif action != 'timeout_prompt':
                os.write(fd, secret + b'\n')
            if action in ('cancel', 'timeout'):
                wait_for(b'SIMULATED_WAITING')
                if action == 'cancel':
                    os.write(fd, b'\x03')
            elif action == 'success':
                wait_for(b'AUTH_RESULT_UNIQUE')
            wait_for(b'manual mode on', raw.index(b'SIMULATED_PASSWORD:'))
            capture(0.3)
            # Both the model result logs and key/frame debug logs must exclude input.
            assert secret not in raw, 'Password was echoed into the terminal capture'
            for file in fixture.rglob('*'):
                if file.is_file():
                    assert secret not in file.read_bytes(), f'Password leaked into {file.name}'
            verification_events = len(events)
            os.write(fd, b'/exit')
            capture(0.2)
            os.write(fd, b'\r')
            finished = 0
            for _ in range(40):
                capture(0.15)
                finished, _ = os.waitpid(pid, os.WNOHANG)
                if finished == pid:
                    break
            assert finished == pid, f'Fuller input was not restored: {raw[-2400:]!r}; keys: {(fixture / "keys.log").read_text()[-1600:]}'
            flags = termios.tcgetattr(fd)[3]
            assert flags & termios.ECHO and flags & termios.ICANON, 'Terminal echo/canonical mode was not restored on exit'
            OUTPUT.mkdir(parents=True, exist_ok=True)
            header = {'version': 2, 'width': 100, 'height': 28, 'title': f'Fuller simulated authentication: {mode}/{action}', 'fuller_verification_events': verification_events}
            (OUTPUT / f'{mode}-{action}.cast').write_text('\n'.join(json.dumps(row, ensure_ascii=False) for row in [header, *events]) + '\n')
            print(f'PASS {mode}/{action}: hidden input, logs clean, prompt restored')
        finally:
            try:
                # A failing child may be blocked writing to a full PTY. Never
                # wait for its graceful shutdown without draining that PTY.
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                os.waitpid(pid, 0)
            except ChildProcessError:
                pass
            os.close(fd)


if __name__ == '__main__':
    for mode in ([sys.argv[1]] if len(sys.argv) > 1 else ('classic', 'fullscreen')):
        for action in ([sys.argv[2]] if len(sys.argv) > 2 else ('success', 'cancel', 'timeout', 'cancel_prompt', 'timeout_prompt')):
            scenario(mode, action)
