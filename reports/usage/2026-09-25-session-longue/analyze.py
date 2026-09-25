#!/usr/bin/env python3
"""Inspect the sessions the long run left in the private home, and the captured screens."""
import glob, json, os, re, collections

LONG = os.path.dirname(os.path.abspath(__file__))
files = sorted(glob.glob(os.path.join(LONG, 'home', '.fuller', 'projects', '*', '*.json')))
print('session files:', [os.path.basename(f) for f in files])
for f in files:
    s = json.load(open(f))
    msgs = s.get('messages', []); hist = s.get('history', [])
    print(f'\n== {os.path.basename(f)}  messages={len(msgs)} history={len(hist)} meta={ {k: v for k, v in s.get("meta", {}).items() if k in ("model", "tokenCount", "title")} }')
    kinds = collections.Counter(f"{m.get('role')}/{m.get('kind', '')}" for m in msgs)
    print(' message kinds:', dict(kinds))
    tools = collections.Counter(); failed = collections.Counter()
    for m in msgs:
        for p in m.get('parts') or []:
            if p.get('type') == 'tool':
                tc = p['toolCall']; tools[tc['name']] += 1
                if tc.get('status') == 'failed': failed[tc['name']] += 1
    print(' tool calls:', dict(tools), ' failed:', dict(failed))
    # History integrity: every model functionCall answered by the next user functionResponse (same id/name).
    dangling = 0; responses = 0; cleared = 0; cleared_tools = collections.Counter(); biggest = 0
    for i, c in enumerate(hist):
        parts = c.get('parts') or []
        calls = [p['functionCall'] for p in parts if 'functionCall' in p]
        if c.get('role') == 'model' and calls:
            nxt = hist[i + 1] if i + 1 < len(hist) else None
            resp = [p['functionResponse'] for p in (nxt or {}).get('parts') or [] if 'functionResponse' in p]
            if len(resp) != len(calls): dangling += 1
        for p in parts:
            if 'functionResponse' in p:
                responses += 1
                out = str((p['functionResponse'].get('response') or {}).get('output', ''))
                biggest = max(biggest, len(out))
                if out.startswith('[Cleared from context'):
                    cleared += 1
                    m = re.search(r'the output of (\w+)\(', out); cleared_tools[m.group(1) if m else '?'] += 1
    sigs = sum(1 for c in hist for p in c.get('parts') or [] if p.get('thoughtSignature'))
    print(f' history: responses={responses} cleared={cleared} {dict(cleared_tools)} unmatched call/response rounds={dangling} thought signatures={sigs} biggest response={biggest} chars')
    print(' first user texts:', [ (m.get('content') or '')[:70] for m in msgs if m.get('role') == 'user'][:6])
    notices = [ (m.get('content') or '')[:120] for m in msgs if m.get('role') == 'system']
    print(' system notices:', notices[:12])
    assistants = [m for m in msgs if m.get('role') == 'assistant']
    if assistants:
        print(' last assistant text:', (assistants[-1].get('content') or '')[:600].replace('\n', ' | '))

for name in ('phase1', 'phase2'):
    p = os.path.join(LONG, f'{name}.txt')
    if not os.path.exists(p): continue
    t = open(p, 'rb').read().decode('utf8', 'replace')
    print(f'\n== {name}.txt ({len(t)} chars)')
    for marker in ('Interrupted', 'Cleared tool output', 'Cached prompt', 'Total tokens', 'API calls', 'Error', 'Tests ', 'passed', 'failed'):
        for m in re.finditer(re.escape(marker), t):
            line = t[max(0, t.rfind('\n', 0, m.start())):t.find('\n', m.end())].strip()
            print(f'  {marker}: {line[:160]}')
            break
