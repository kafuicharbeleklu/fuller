#!/usr/bin/env python3
"""Resize regression test in a real VTE terminal (the engine of GNOME Terminal).

Usage: python3 scripts/resize-test-vte.py <scratch-dir> <project-dir> [steps] [interval-ms]
  steps       comma-separated column widths, e.g. "119,118,117" (default: a 6-step drag)
  interval-ms delay between steps (default 150; use 30 or less to simulate a fast drag)

Requires python3-gi with Vte 2.91 (GTK 3) and a display. Prints, for each phase, how
many input boxes / placeholders / broken box lines are present in the terminal
history: a clean run shows exactly one input box after every resize.
"""
import gi, os, sys, re
import gi, os, sys, re
gi.require_version('Gtk', '3.0'); gi.require_version('Vte', '2.91')
from gi.repository import Gtk, Vte, GLib
S, PROJ = sys.argv[1], sys.argv[2]
def parse_step(x):
    if ':' in x:
        c, r = x.split(':'); return (int(c), int(r))
    return (int(x), 40)
steps = [parse_step(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 else [(110,40), (100,40), (92,40), (86,40), (80,40), (76,40)]
interval = int(sys.argv[4]) if len(sys.argv) > 4 else 150
win = Gtk.OffscreenWindow()
term = Vte.Terminal()
term.set_scrollback_lines(20000)
def resize(cols, rows=40):
    cw, ch = term.get_char_width(), term.get_char_height()
    term.set_size_request(cols * cw, rows * ch)
    win.resize(cols * cw, rows * ch)
    term.set_size(cols, rows)
    return False
win.add(term); win.show_all()
resize(120, 40)
term.spawn_async(Vte.PtyFlags.DEFAULT, PROJ, ['npx', 'tsx', 'src/index.tsx', '-d', S + '/ws'], env, GLib.SpawnFlags.DEFAULT, None, None, -1, None, lambda t, pid, err, *a: print('spawned pid', pid, 'err', err, flush=True))
captures = {}
def full_text():
    adj = term.get_vadjustment()
    first = int(adj.get_lower()); last = int(adj.get_upper()) + term.get_row_count()
    try:
        txt = term.get_text_range_format(Vte.Format.TEXT, first, 0, last, term.get_column_count())
        txt = txt[0] if isinstance(txt, tuple) else txt
    except Exception as e:
        print('get_text_range_format failed:', e)
        txt = term.get_text_format(Vte.Format.TEXT)
    return txt or ''
term.connect('child-exited', lambda t, status: print('child exited', status, flush=True))
def report(label):
    lines = full_text().split('\n')
    captures[label] = lines
    ph = sum('Try "fix the failing test"' in l for l in lines)
    wel = sum('Welcome to Fuller' in l for l in lines)
    tops = sum(l.lstrip().startswith('╭') for l in lines)
    inputs = sum(l.startswith('│ >') for l in lines)
    broken = sum(1 for l in lines if l.startswith('│ >') and not l.rstrip().endswith('│'))
    print(f'[{label}] cols={term.get_column_count()} placeholders={ph} welcome={wel} box-tops={tops} input-lines={inputs} broken-input-lines={broken} nonempty={sum(1 for l in lines if l.strip())}', flush=True)

def feed(s):
    term.feed_child(s.encode()); return False
def finish():
    tail = [l for l in captures.get('drag', []) if l.strip()][-14:]
    print('--- drag capture tail ---'); print('\n'.join(tail))
    Gtk.main_quit(); return False
t = 0
def at(ms, fn, *a):
    GLib.timeout_add(ms, lambda: fn(*a))
at(7000, feed, '/help\r')
at(10000, lambda: (report('before'), False)[1])
at(10500, resize, 80)
at(13000, lambda: (report('shrink'), False)[1])
at(13500, resize, 120)
at(16000, lambda: (report('grow'), False)[1])
base = 16500
for i, (w, h) in enumerate(steps):
    at(base + i * interval, resize, w, h)
at(base + len(steps) * interval + 2500, lambda: (report('drag'), False)[1])
at(base + len(steps) * interval + 3000, resize, 120, 30)
at(base + len(steps) * interval + 5500, lambda: (report('final'), False)[1])
at(base + len(steps) * interval + 6000, feed, '/exit\r')
at(base + len(steps) * interval + 8000, finish)
Gtk.main()
