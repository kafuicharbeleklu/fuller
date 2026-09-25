#!/usr/bin/env python3
"""Long real session: a coding task, Ctrl+C mid-turn, continue, /stats, /exit, then --continue and ask."""
import os, pty, re, select, sys, time, signal, struct, fcntl, termios

LONG = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(LONG, 'repo')
HOME = os.path.join(LONG, 'home')
DIST = '/home/administrator/Desktop/gemini-code/dist/index.js'
ANSI = re.compile(rb'\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\r')

TASK = ("Write scripts/session-report.mjs, a Node script that takes the path of a Fuller session file "
        "(~/.fuller/projects/<project>/<id>.json; format in src/session/store.ts, message shapes in src/agent/types.ts) "
        "and prints: the number of user prompts, of assistant messages, tool calls per tool name, failed tool calls, "
        "and how many tool responses in the `history` array have an output starting with '[Cleared from context'. "
        "Add tests/sessionReport.test.ts with a small fixture written to a temp file. Read the relevant source files first "
        "(store.ts, types.ts, and how loop.ts fills messages and history). Then run `npm run typecheck` and "
        "`npx vitest run tests/sessionReport.test.ts` and report the results.")

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

def resize(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

def read_for(fd, seconds):
    end = time.monotonic() + seconds
    data = bytearray()
    while time.monotonic() < end:
        r = select.select([fd], [], [], min(0.1, max(0, end - time.monotonic())))[0]
        if not r:
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
        chunk = read_for(fd, 0.25)
        seen.extend(chunk); sink.extend(chunk)
    return marker in seen

def wait_idle(fd, quiet, timeout, sink, stop_when=None):
    """Until no output for `quiet` seconds (the spinner animates while busy)."""
    start = time.monotonic(); last = start
    while time.monotonic() - start < timeout:
        chunk = read_for(fd, 0.5)
        if chunk:
            sink.extend(chunk); last = time.monotonic()
            if stop_when and stop_when(sink):
                return 'stop'
        elif time.monotonic() - last >= quiet:
            return 'idle'
    return 'timeout'

def spawn(extra):
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(REPO)
        env = dict(os.environ, HOME=HOME, TERM='xterm-256color')
        env.pop('GEMINI_API_KEY', None); env.pop('GEMINI_API_KEYS', None)
        os.execvpe('node', ['node', DIST, '--tui', 'classic', '--dangerously-skip-permissions', *extra], env)
    resize(fd, 40, 140)
    return pid, fd

def finish(pid, fd, sink, name):
    end = time.monotonic() + 30
    while time.monotonic() < end:
        sink.extend(read_for(fd, 0.5))
        done, _ = os.waitpid(pid, os.WNOHANG)
        if done:
            break
    else:
        log('process did not exit: killing'); os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0)
    with open(os.path.join(LONG, f'{name}.raw'), 'wb') as f: f.write(sink)
    with open(os.path.join(LONG, f'{name}.txt'), 'wb') as f: f.write(ANSI.sub(b'', bytes(sink)))

def phase1():
    log('phase 1: start, task, interrupt, continue, /stats, /exit')
    pid, fd = spawn([])
    sink = bytearray()
    assert wait_until(fd, b'Fuller', 40, sink), 'no startup'
    wait_idle(fd, 3, 30, sink)
    os.write(fd, TASK.encode() + b'\r')
    # Interrupt once the model is in the middle of its tool calls (at least 4 tool rows, after 20 s), or at 75 s.
    t0 = time.monotonic()
    def enough(buf):
        return time.monotonic() - t0 > 20 and buf.count('⏺'.encode()) >= 4
    state = wait_idle(fd, 6, 75, sink, stop_when=enough)
    log(f'interrupting after {time.monotonic() - t0:.0f}s ({state}, {sink.count("⏺".encode())} tool rows)')
    os.write(fd, b'\x03')
    got = wait_until(fd, b'Interrupted', 20, sink)
    log(f'interrupted marker: {got}')
    wait_idle(fd, 3, 20, sink)
    os.write(fd, b'Continue where you stopped and finish the whole task, including typecheck and the test run.\r')
    state = wait_idle(fd, 8, 900, sink)
    log(f'turn 2 ended: {state}')
    os.write(fd, b'/stats\r'); wait_idle(fd, 2, 15, sink)
    os.write(fd, b'/exit\r')
    finish(pid, fd, sink, 'phase1')

def phase2():
    log('phase 2: --continue, ask from memory, rerun the test, /stats, /exit')
    pid, fd = spawn(['--continue'])
    sink = bytearray()
    assert wait_until(fd, b'Fuller', 40, sink), 'no startup'
    wait_idle(fd, 3, 30, sink)
    os.write(fd, b'Without using any tool: which files did you create or change, which commands verified them, and what were the results? Answer from this conversation.\r')
    wait_idle(fd, 6, 300, sink)
    os.write(fd, b'Now run `npx vitest run tests/sessionReport.test.ts` once more and tell me the result.\r')
    wait_idle(fd, 8, 300, sink)
    os.write(fd, b'/stats\r'); wait_idle(fd, 2, 15, sink)
    os.write(fd, b'\x1b'); wait_idle(fd, 1, 5, sink)  # close the /stats dialog, else /exit is typed into it
    os.write(fd, b'/exit\r')
    finish(pid, fd, sink, 'phase2')

if __name__ == '__main__':
    which = sys.argv[1:] or ['phase1', 'phase2']
    if 'phase1' in which: phase1(); time.sleep(2)
    if 'phase2' in which: phase2()
    log('done')
