#!/usr/bin/env python3
"""Real task in auto mode: Fuller improves its own compaction, in an isolated git worktree.

The driver answers the permission cards auto mode leaves to the user: a known safe command (tests,
type check, read-only git and file listing) is approved; anything else is refused with a comment,
so the turn goes on without it. Every card is logged. No bypass mode.
"""
import os, pty, re, select, sys, time, signal, struct, fcntl, termios, json

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get('FULLER_TASK_WORKTREE', '/tmp/fuller-task-compaction')
DIST = '/home/administrator/Desktop/gemini-code/dist/index.js'
ANSI = re.compile(rb'\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\r')

TASK = ("Improve conversation compaction in this repository (Fuller, a TypeScript terminal coding agent). "
        "Today `compactHistory` in src/agent/gemini.ts asks the model for a ~600-word summary of `historyToText(history)`, "
        "and `AgentLoop.compact` in src/agent/loop.ts replaces the conversation with that summary. Two problems: "
        "(1) the user's own messages are paraphrased by the model, so an instruction such as 'do not touch tests/' can be lost after compaction; "
        "(2) nothing checks the summary for omissions. Change it so that: "
        "(a) the compacted context always ends with a section 'User messages (verbatim)' listing every message the user typed in the conversation "
        "(not tool results, not injected notices), word for word, oldest first, built in code rather than by the model, with a cap of 12,000 characters "
        "where the oldest messages are shortened first and the latest one is never shortened; "
        "(b) a second, short model pass compares the summary with the conversation and appends only what is missing (open errors, unfinished steps, "
        "file paths, decisions), or nothing when the summary is complete; if that pass fails, keep the summary without it. "
        "Keep the existing sections and the `focus` argument. Add focused Vitest tests under tests/ that mock the model (no API key). "
        "Run `npm run typecheck`, the test files you touched, then the full `npm test`, and report what you changed and the results.")

SAFE = re.compile(r'^(npm (run )?(test|typecheck)|npx (vitest|tsc)|git (status|diff|log|show)|ls|cat|head|tail|wc|grep|rg|find|sed -n)\b')

def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(os.path.join(HERE, 'pilote.log'), 'a') as f: f.write(line + '\n')

def read_for(fd, seconds):
    end = time.monotonic() + seconds
    data = bytearray()
    while time.monotonic() < end:
        if not select.select([fd], [], [], min(0.1, max(0, end - time.monotonic())))[0]:
            continue
        try: chunk = os.read(fd, 65536)
        except OSError: break
        if not chunk: break
        data.extend(chunk)
    return bytes(data)

BUSY = b'esc to interrupt'
IDLE_MARKS = (b'shift+tab to cycle', b'? for shortcuts')
CARD = re.compile(rb'Do you want to proceed\?|Do you want to make this edit|Do you want to create|Would you like to proceed\?')

def last_idle(sink):
    return max(sink.rfind(m) for m in IDLE_MARKS)

def card_open(sink, handled):
    m = None
    for m in CARD.finditer(sink):
        pass
    return m is not None and m.start() > handled and sink.rfind(b'Esc to cancel') > m.start()

def card_command(sink):
    text = ANSI.sub(b'', bytes(sink[-6000:])).decode('utf8', 'replace')
    at = text.rfind('Bash command')
    if at < 0: return None, text[-600:]
    lines = [l.strip() for l in text[at:].split('\n')[1:6] if l.strip()]
    return (lines[0] if lines else ''), text[at:at + 600]

def main():
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(WORK)
        env = dict(os.environ, TERM='xterm-256color')
        os.execvpe('node', ['node', DIST, '--tui', 'classic', '--permission-mode', 'auto'], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 140, 0, 0))
    sink = bytearray()
    start = time.monotonic()
    while time.monotonic() - start < 40 and b'Fuller' not in sink and b'Accessing workspace' not in sink:
        sink.extend(read_for(fd, 0.5))
    if b'Accessing workspace' in sink:
        sink.extend(read_for(fd, 1.5))
        os.write(fd, b'\x1b[B'); sink.extend(read_for(fd, 0.6))
        os.write(fd, b'\r'); log('folder trusted')
        while b'shortcuts' not in sink[-4000:] and time.monotonic() - start < 60: sink.extend(read_for(fd, 0.5))
    sink.extend(read_for(fd, 3))
    log('task sent (auto mode)')
    os.write(fd, TASK.encode() + b'\r')
    handled = len(sink)
    cards = []
    last_output = time.monotonic()
    turn_start = time.monotonic()
    continues = 0
    while True:
        chunk = read_for(fd, 0.5)
        if chunk:
            sink.extend(chunk); last_output = time.monotonic()
        if card_open(sink, handled):
            sink.extend(read_for(fd, 0.8))
            command, excerpt = card_command(sink)
            ok = bool(command) and bool(SAFE.match(command))
            cards.append({'at': round(time.monotonic() - turn_start), 'command': command, 'approved': ok, 'excerpt': excerpt[:400]})
            log(f"card: {command!r} -> {'yes' if ok else 'no + comment'}")
            if ok:
                os.write(fd, b'\r')
            else:
                # "No" is the last option; Tab opens its comment field.
                os.write(fd, b'\x1b[F'); sink.extend(read_for(fd, 0.4))
                os.write(fd, b'\t'); sink.extend(read_for(fd, 0.4))
                os.write(fd, b'Not approved by the unattended driver: do it another way inside this repository, or skip it and say so in your report.')
                sink.extend(read_for(fd, 0.4))
                os.write(fd, b'\r')
            handled = len(sink)
            continue
        quiet = time.monotonic() - last_output
        if quiet >= 10 and sink.rfind(BUSY) < last_idle(sink):
            if sink.count(b'Max turns reached') > continues and continues < 2:
                continues += 1; log(f'continue #{continues}'); os.write(fd, b'Continue.\r'); handled = len(sink); continue
            log('turn ended')
            break
        if time.monotonic() - turn_start > 3600:
            log('timeout after 1 h'); break
    os.write(fd, b'/status\r'); sink.extend(read_for(fd, 3))
    os.write(fd, b'\x1b[C'); sink.extend(read_for(fd, 1))
    os.write(fd, b'\x1b[C'); sink.extend(read_for(fd, 2))
    os.write(fd, b'\x1b'); sink.extend(read_for(fd, 1))
    os.write(fd, b'/exit\r')
    end = time.monotonic() + 30
    while time.monotonic() < end:
        sink.extend(read_for(fd, 0.5))
        if os.waitpid(pid, os.WNOHANG)[0]: break
    else:
        log('did not exit: killing'); os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0)
    open(os.path.join(HERE, 'session.raw'), 'wb').write(sink)
    open(os.path.join(HERE, 'session.txt'), 'wb').write(ANSI.sub(b'', bytes(sink)))
    json.dump(cards, open(os.path.join(HERE, 'cartes.json'), 'w'), indent=2, ensure_ascii=False)
    log(f'done: {len(cards)} cards, {sum(c["approved"] for c in cards)} approved')

if __name__ == '__main__':
    main()
