#!/usr/bin/env python3
"""Exercise idle TUI startup, terminal resizes, and cleanup through a real PTY."""

import fcntl
import json
import os
import pty
import select
import signal
import struct
import termios
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def capture(fd: int, seconds: float) -> bytes:
    end = time.monotonic() + seconds
    data = bytearray()
    while time.monotonic() < end:
        if not select.select([fd], [], [], min(0.1, end - time.monotonic()))[0]:
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        data.extend(chunk)
    return bytes(data)


def capture_for(fd: int, markers, minimum: float, timeout: float = 5.0) -> bytes:
    """Read at least `minimum` seconds, then on until one of `markers` shows up (a slow machine lags)."""
    markers = [markers] if isinstance(markers, bytes) else list(markers or [])
    data = bytearray(capture(fd, minimum))
    end = time.monotonic() + timeout
    while markers and not any(m in data for m in markers) and time.monotonic() < end:
        data.extend(capture(fd, 0.1))
    return bytes(data)


def capture_until(fd: int, marker: bytes, timeout: float = 20.0) -> bytes:
    # Generous: this suite checks the screen, not startup speed (a busy machine took 4 to 11 s).
    end = time.monotonic() + timeout
    data = bytearray()
    while marker not in data and time.monotonic() < end:
        data.extend(capture(fd, min(0.25, end - time.monotonic())))
    assert marker in data, f"startup marker {marker!r} missing: {bytes(data[-500:])!r}"
    return bytes(data)


# A private home per scenario: the smoke test must not read or write the user's
def trust_folder(config_root, folder) -> None:
    """Fuller asks before trusting a new folder: tests trust theirs in their private config root."""
    target = os.path.join(str(config_root), ".fuller", "trusted-folders.json")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w") as handle:
        json.dump({"folders": [os.path.realpath(str(folder))]}, handle)


# ~/.fuller, and one scenario's commands must not reorder the next one's / menu.
def smoke_home() -> str:
    home = tempfile.mkdtemp(prefix="fuller-smoke-home-")
    os.makedirs(os.path.join(home, ".fuller"), exist_ok=True)
    trust_folder(home, ROOT)
    # The dummy key cannot answer: no model reply after `!` commands.
    with open(os.path.join(home, ".fuller", "settings.json"), "w") as settings:
        json.dump({"replyAfterShell": False}, settings)
    return home

def resize(fd: int, rows: int, columns: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))


def scenario(mode: str, width: int, active: bool = False) -> None:
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(ROOT)
        env = dict(os.environ, HOME=smoke_home(), GEMINI_API_KEY="ui_audit_dummy", TERM="xterm-256color")
        os.execvpe("node", ["node", "dist/index.js", "--tui", mode], env)
    try:
        resize(fd, 28, width)
        startup = capture_until(fd, b"manual mode on") + capture(fd, 0.25)
        assert b"Fuller" in startup, "startup identity was not shown"
        menu_output = b""
        if active:
            os.write(fd, b"/")
            menu = capture_for(fd, b"/about", 0.35)
            # Claude Code style: the list above the prompt, no navigation hint line.
            assert b"/about" in menu and b"Navigate" not in menu, "slash menu did not open"
            os.write(fd, b"\x1b[B")
            navigated = capture_for(fd, b"/accept-edits", 0.25)
            assert b"/accept-edits" in navigated, "down arrow did not move the slash selection"
            os.write(fd, b"\x1b[A\r")
            selected = capture_for(fd, b"Virginia Calculator", 0.35)
            assert b"Virginia Calculator" in selected, "Enter did not select the slash command"
            menu_output = menu + navigated + selected
            os.write(fd, b"!sleep 2\r")
            running = capture_for(fd, b"sleep 2", 0.3)
            assert b"sleep 2" in running, "shell command did not start"
        resize(fd, 10, max(25, width // 2))
        shrunk = capture(fd, 0.6)
        resize(fd, 36, min(200, width + 60))
        grown = capture(fd, 0.6)
        completed = capture(fd, 1.8) if active else b""
        interaction = b""
        if active:
            os.write(fd, b"\x0f")  # Ctrl+O
            transcript_view = capture_for(fd, b"Showing detailed transcript", 0.3)
            assert b"Showing detailed transcript" in transcript_view, "Ctrl+O did not open the transcript"
            os.write(fd, b"q")
            interaction += transcript_view + capture(fd, 0.15)
            os.write(fd, b"/diff\r")
            diff_view = capture_for(fd, (b"Diff panel shown", b"Enter to open"), 0.4)
            if mode == "fullscreen" and min(200, width + 60) >= 110:
                # Claude Code opens /diff as a panel beside the conversation from 110 columns.
                assert b"Diff panel shown" in diff_view, f"/diff did not open the diff panel: {diff_view[-1500:]!r}"
                os.write(fd, b"/diff\r")
            else:
                assert b"Enter to open" in diff_view, "/diff did not open the diff viewer"
                os.write(fd, b"q")
            interaction += diff_view + capture(fd, 0.15)
        os.write(fd, b"\x03\x03")
        output = startup + menu_output + (running if active else b"") + shrunk + grown + completed + interaction + capture_for(fd, b"\x1b[?1049l" if mode == "fullscreen" else None, 0.4)
        assert shrunk and grown, f"idle resize did not trigger a redraw (shrink={len(shrunk)}, grow={len(grown)})"
        if mode == "fullscreen":
            assert b"\x1b[?1049h" in output, "alternate screen was not entered"
            assert b"\x1b[?1049l" in output, "alternate screen was not restored"
        else:
            assert b"\x1b[?1049h" not in output, "classic mode entered alternate screen"
        assert b"Fuller" in output, f"startup UI did not render: {output[:500]!r}"
        assert b"TypeError:" not in output and b"Error:" not in output, "startup reported an error"
        if active:
            assert b"sleep 2" in output and b"Worked" not in output, "shell command was not rendered normally"
        print(f"PASS {mode} {width} columns, {'active' if active else 'idle'} shrink and grow, {len(output)} raw bytes")
    finally:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
        os.close(fd)


def screen_reader_scenario() -> None:
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(ROOT)
        env = dict(os.environ, HOME=smoke_home(), GEMINI_API_KEY="ui_audit_dummy", TERM="xterm-256color")
        os.execvpe("node", ["node", "dist/index.js", "--screen-reader"], env)
    try:
        startup = capture_until(fd, b"you: ")
        os.write(fd, b"/help\r")
        help_text = capture(fd, 0.3)
        os.write(fd, b"/exit\r")
        end = capture(fd, 0.3)
        assert b"Screen Reader Mode" in startup and b"Enter a prompt" in help_text, (startup[-700:], help_text[-700:])
        assert b"\x1b[?1049h" not in startup + help_text + end
        print("PASS screen reader startup, help and exit")
    finally:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
        os.close(fd)


def model_picker_scenario(mode: str) -> None:
    with tempfile.TemporaryDirectory(prefix="fuller-picker-") as home:
        config_dir = Path(home) / ".fuller"
        config_dir.mkdir()
        trust_folder(home, ROOT)
        models = [
            dict(id=model, displayName=model, description="A capable Gemini chat model",
                 inputTokenLimit=1_048_576, outputTokenLimit=65_536, actions=["generateContent"])
            for model in ("gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash")
        ]
        (config_dir / "models.json").write_text(json.dumps(dict(at=int(time.time() * 1000), models=models)))
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(ROOT)
            env = dict(os.environ, HOME=home, GEMINI_API_KEY="ui_audit_dummy", TERM="xterm-256color")
            os.execvpe("node", ["node", "dist/index.js", "--tui", mode], env)
        try:
            resize(fd, 18, 60)
            capture_until(fd, b"manual mode on")
            capture(fd, 0.4)
            os.write(fd, b"/model")
            capture(fd, 0.2)
            os.write(fd, b"\r")
            opened = capture_until(fd, b"Select model") + capture(fd, 0.3)
            assert b"effort" in opened and b"to adjust" in opened, "model picker effort control was not shown"
            if mode == "fullscreen":
                assert b"Fuller" in opened, "the conversation disappeared above the picker"
            else:
                assert b"\x1b[?1000h\x1b[?1006h" in opened, "classic picker did not enable mouse wheel tracking"
            os.write(fd, b"\x1b[D")
            changed = capture(fd, 0.3)
            # Flash thinks at "high" by default: one Left goes to medium.
            assert b"Medium effort" in changed, "Left did not adjust the model picker effort"
            resize(fd, 12, 40)
            shrunk = capture(fd, 0.5)
            resize(fd, 28, 100)
            grown = capture(fd, 0.5)
            assert b"Select model" in shrunk and b"Select model" in grown, "picker disappeared on resize"
            os.write(fd, b"\x1b")
            closed = capture(fd, 0.4)
            assert b"Kept model" in closed, "Escape did not close the picker with feedback"
            if mode == "classic":
                assert b"\x1b[?1000l\x1b[?1006l" in closed, "classic picker left mouse tracking enabled"
            os.write(fd, b"/model gemini-3.8-flash")
            capture(fd, 0.2)
            os.write(fd, b"\r")
            switched = capture(fd, 0.6)
            saved = json.loads((config_dir / "settings.json").read_text())
            assert saved["model"] == "gemini-3.8-flash", "direct /model did not save the default"
            assert saved["thinkingLevel"] == "high", "direct /model saved the wrong default effort"
            assert b"default for new sessions" in switched, "direct model switch feedback was missing"
            assert b"Error:" not in opened + changed + shrunk + grown + closed + switched
            print(f"PASS {mode} /model picker at 18 rows, effort, resize, Escape and default persistence")
        finally:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            os.waitpid(pid, 0)
            os.close(fd)


def tui_switch_scenario() -> None:
    """/tui switches renderer in the session, both ways, keeping the conversation and the input."""
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(ROOT)
        env = dict(os.environ, HOME=smoke_home(), GEMINI_API_KEY="ui_audit_dummy", TERM="xterm-256color")
        os.execvpe("node", ["node", "dist/index.js"], env)
    try:
        resize(fd, 30, 120)
        startup = capture_until(fd, b"manual mode on")
        assert b"\x1b[?1049h" in startup, "did not start fullscreen"
        os.write(fd, b"!echo before-switch\r")
        assert b"before-switch" in capture_for(fd, b"before-switch", 0.5, 8), "shell command did not run"
        os.write(fd, b"/tui")
        capture(fd, 0.3)
        os.write(fd, b"\r")
        # The notice is drawn before the interface is torn down: wait for the screen switch itself.
        classic = capture_for(fd, b"\x1b[?1049l", 0.5, 15) + capture_for(fd, b"before-switch", 0.5, 10)
        assert b"\x1b[?1049l" in classic, "/tui did not leave the alternate screen"
        assert b"before-switch" in classic, "the conversation was lost when switching to the default renderer"
        os.write(fd, b"!echo after-classic\r")
        assert b"after-classic" in capture_for(fd, b"after-classic", 0.5, 8), "input did not respond after /tui"
        os.write(fd, b"/tui fullscreen")
        capture(fd, 0.3)
        os.write(fd, b"\r")
        full = capture_for(fd, b"\x1b[?1049h", 0.5, 15) + capture_for(fd, b"after-classic", 0.5, 10)
        assert b"\x1b[?1049h" in full, "/tui fullscreen did not enter the alternate screen"
        assert b"after-classic" in full, "the conversation was lost when switching back"
        os.write(fd, b"\x03\x03")
        assert b"\x1b[?1049l" in capture_for(fd, b"\x1b[?1049l", 0.5, 8), "alternate screen not restored at exit"
        print("PASS /tui switches to the default renderer and back, keeping the conversation")
    finally:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
        os.close(fd)


if __name__ == "__main__":
    for renderer in ("classic", "fullscreen"):
        for columns in (60, 100, 160):
            scenario(renderer, columns)
        scenario(renderer, 100, active=True)
        model_picker_scenario(renderer)
    screen_reader_scenario()
    tui_switch_scenario()
