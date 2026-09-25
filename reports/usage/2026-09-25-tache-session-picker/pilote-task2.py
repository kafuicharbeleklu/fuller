#!/usr/bin/env python3
"""Real task in the real repo with the real ~/.fuller: reproduce then fix the flaky session picker test."""
import os, pty, re, select, sys, time, signal, struct, fcntl, termios

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = '/home/administrator/Desktop/gemini-code'
DIST = os.path.join(REPO, 'dist/index.js')
ANSI = re.compile(rb'\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\r')

TASK = ("tests/sessionPicker.test.tsx fails intermittently when the whole suite runs in parallel: in the test "
        "'filters by typing, clears the filter with Esc, then cancels, and filters by branch with ctrl+b', after typing 'beta' "
        "the frame still shows the initial list and its help line instead of the search. It passes alone. It failed again today "
        "during a full `npm test` on a loaded machine (log: reports/usage/2026-09-25-session-longue/npm-test-exit1-call70.log). "
        "Reproduce first: read the test and src/ui/SessionPicker.tsx, then run the file under load (for example the whole suite, "
        "or this file while other vitest files run) until you see the failure at least once, or until 4 attempts show it never fails. "
        "Compare with tests/themePicker.test.tsx, fixed today with explicit vi.waitFor waits instead of fixed delays. "
        "Then make the minimal change to the test's synchronisation (touch the component only if it is really at fault), "
        "and verify: the file alone 10 times in a row, and the full `npm test` twice. Report what you observed, what you changed and the results.")

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

def resize(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

def read_for(fd, seconds):
    end = time.monotonic() + seconds
    data = bytearray()
    while time.monotonic() < end:
        if not select.select([fd], [], [], min(0.1, max(0, end - time.monotonic())))[0]:
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        data.extend(chunk)
    return bytes(data)

def wait_until(fd, marker, timeout, sink):
    end = time.monotonic() + timeout
    seen = bytearray()
    while marker not in seen and time.monotonic() < end:
        chunk = read_for(fd, 0.25); seen.extend(chunk); sink.extend(chunk)
    return marker in seen

BUSY = b'esc to interrupt'
IDLE = b'shift+tab to cycle'

def wait_idle(fd, quiet, timeout, sink, footer=True):
    """Idle when the footer last showed the idle hint (not "esc to interrupt") and nothing came for `quiet` s.
    A retry wait or a quota wait is silent but keeps "esc to interrupt": it is not the end of the turn."""
    start = time.monotonic(); last = start
    while time.monotonic() - start < timeout:
        chunk = read_for(fd, 0.5)
        if chunk:
            sink.extend(chunk); last = time.monotonic()
        elif time.monotonic() - last >= quiet:
            if not footer or sink.rfind(BUSY) < sink.rfind(IDLE):
                return 'idle'
    return 'timeout'

def main():
    resume = '--continue' in sys.argv
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(REPO)
        env = dict(os.environ, TERM='xterm-256color')
        if os.environ.get('FULLER_TASK_HOME'): env['HOME'] = os.environ['FULLER_TASK_HOME']
        model = ['--model', os.environ['FULLER_TASK_MODEL']] if os.environ.get('FULLER_TASK_MODEL') else []
        os.execvpe('node', ['node', DIST, '--tui', 'classic', '--dangerously-skip-permissions', *model, *(['--continue'] if resume else [])], env)
    resize(fd, 40, 140)
    sink = bytearray()
    assert wait_until(fd, (b'Accessing workspace'), 40, sink) or True, 'no startup'
    wait_idle(fd, 2, 20, sink)
    if b'Accessing workspace' in sink:
        # First run in the user's own repository: trust it (Down to "Yes, I trust this folder", Enter).
        os.write(fd, b'\x1b[B'); wait_idle(fd, 1, 5, sink)
        os.write(fd, b'\r'); log('folder trusted')
        assert wait_until(fd, b'Fuller', 40, sink), 'no startup after trust'
        wait_idle(fd, 3, 30, sink)
    assert b'Fuller' in sink, 'no startup'
    log('task sent' if not resume else 'resumed: continue sent')
    os.write(fd, (TASK.encode() if not resume else b'Continue the task where you stopped (the API was overloaded, nothing else happened).') + b'\r')
    continues = 0
    while True:
        state = wait_idle(fd, 8, 2400, sink)
        log(f'turn ended: {state}; max-turns notices so far: {sink.count(b"Max turns reached")}')
        if sink.count(b'Max turns reached') > continues and continues < 2:
            continues += 1
            log(f'continue #{continues}')
            os.write(fd, b'Continue.\r')
            continue
        break
    # /status → Usage tab (two Right arrows), for the cache and cleared-output rows.
    os.write(fd, b'/status\r'); wait_idle(fd, 2, 15, sink, footer=False)
    os.write(fd, b'\x1b[C'); wait_idle(fd, 1, 5, sink, footer=False)
    os.write(fd, b'\x1b[C'); wait_idle(fd, 2, 5, sink, footer=False)
    os.write(fd, b'\x1b'); wait_idle(fd, 1, 5, sink, footer=False)
    os.write(fd, b'/exit\r')
    end = time.monotonic() + 30
    while time.monotonic() < end:
        sink.extend(read_for(fd, 0.5))
        if os.waitpid(pid, os.WNOHANG)[0]:
            break
    else:
        log('did not exit: killing'); os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0)
    open(os.path.join(HERE, 'task2.raw'), 'wb').write(sink)
    open(os.path.join(HERE, 'task2.txt'), 'wb').write(ANSI.sub(b'', bytes(sink)))
    log('done')

if __name__ == '__main__':
    main()
