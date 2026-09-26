#!/bin/sh
# Replay the real auto-mode task from the same starting point (9fd9bc7, before Fuller's compaction
# change), with the current Fuller build (its tools included). Compare with session-2-resume.json:
# 145 tool calls (91 searches, 35 reads), 154 API calls, 6.8 M tokens, 27 min.
set -e
REPO=/home/administrator/Desktop/gemini-code
WORK=/tmp/fuller-task-compaction
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$REPO" && npm run build >/dev/null
git -C "$REPO" worktree remove --force "$WORK" 2>/dev/null || true
git -C "$REPO" branch -D fuller/compaction-replay 2>/dev/null || true
git -C "$REPO" worktree add -q "$WORK" -b fuller/compaction-replay 9fd9bc7
ln -s "$REPO/node_modules" "$WORK/node_modules"
rm -f "$HERE/pilote.log"
set -a; . "$REPO/.env"; set +a
cd "$HERE" && python3 pilote-auto.py
