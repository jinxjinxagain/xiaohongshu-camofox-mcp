#!/usr/bin/env python3
"""
Batch search XHS gym accounts using xiaohongshu-camofox-mcp.

Usage:
  CAMOFOX_BASE_URL=http://127.0.0.1:9378 python3 scripts/batch_search_gyms.py

Requires:
  - Camofox running on CAMOFOX_BASE_URL (default: http://127.0.0.1:9378)
  - MCP server dist/index.js to be built
  - gym.shanghai.json in same repo
"""

import subprocess, json, time, os, sys, pty, tty, fcntl, select
from urllib.request import urlopen

GYM_JSON = '/Users/q/Code/where_climb/backend/gym.shanghai.json'
MCP_DIR = '/Users/q/Code/Github/xiaohongshu-camofox-mcp'
CAMOFOX_BASE = os.environ.get('CAMOFOX_BASE_URL', 'http://127.0.0.1:9378')

BATCH_SIZE = 9  # stay under hourly budget (default 10/hour)
COOLDOWN_SECS = 92  # must exceed minToolIntervalMs (90s)


def read_loop(fd, timeout=90):
    result = b''
    end = time.time() + timeout
    while time.time() < end:
        try:
            rdy = select.select([fd], [], [], 0.5)[0]
            if rdy:
                d = os.read(fd, 4096)
                if d: result += d
                else: break
            else:
                if result: break
        except OSError: break
    return result


def parse_json_rpc(raw_bytes):
    text = raw_bytes.decode('utf-8', errors='replace')
    results = []
    for line in text.split('\n'):
        stripped = line.strip()
        if stripped.startswith('{') and 'jsonrpc' in stripped:
            try: results.append(json.loads(stripped))
            except: pass
    return results


def start_mcp():
    master_fd, slave_fd = pty.openpty()
    tty.setraw(slave_fd)
    log_fd = os.open('/tmp/mcp-stderr.log', os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
    proc = subprocess.Popen(
        ['node', 'dist/index.js'],
        cwd=MCP_DIR,
        env={**os.environ, 'CAMOFOX_BASE_URL': CAMOFOX_BASE},
        stdin=slave_fd, stdout=slave_fd, stderr=log_fd, close_fds=True,
    )
    os.close(log_fd)
    os.close(slave_fd)
    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    def send(msg_dict):
        os.write(master_fd, (json.dumps(msg_dict) + '\n').encode())

    # Initialize
    send({'jsonrpc': '2.0', 'method': 'initialize',
          'params': {'protocolVersion': '2024-11-05', 'capabilities': {},
                     'clientInfo': {'name': 'batch', 'version': '1.0'}}, 'id': 0})
    time.sleep(1)
    read_loop(master_fd, 3)

    # smoke_test to init rate limiter
    send({'jsonrpc': '2.0', 'method': 'tools/call',
          'params': {'name': 'smoke_test', 'arguments': {}}, 'id': 1})
    time.sleep(3)
    read_loop(master_fd, 8)

    return proc, master_fd, send


def search_gym(send, master_fd, keyword, limit=5):
    send({'jsonrpc': '2.0', 'method': 'tools/call',
          'params': {'name': 'search_feeds',
                     'arguments': {'keyword': keyword, 'limit': limit}}, 'id': 99})
    time.sleep(5)
    raw = read_loop(master_fd, 60)
    resps = parse_json_rpc(raw)
    if not resps: return None
    try:
        return json.loads(resps[0]['result']['content'][0]['text'])
    except:
        return None


def build_search_terms(gym_name, account_hint):
    """Generate search terms for a gym, most specific first."""
    terms = []
    # Prefer account hint if it has real content
    if account_hint and account_hint not in ('未确认', '未发现', '未发现官方'):
        terms.append(account_hint)
    # Then gym name
    terms.append(gym_name)
    return list(dict.fromkeys(terms))  # dedupe preserving order


def main():
    # Load gym data
    with open(GYM_JSON) as f:
        gyms = json.load(f)

    # Filter: red/yellow status with no userId
    to_search = [
        g for g in gyms
        if g['status'] in ('红', '黄')
        and not g.get('userId')
        and g['account'] not in ('未确认', '未发现')
    ]

    print(f'Found {len(to_search)} gyms to search:')
    for g in to_search:
        print(f"  [{g['status']}] #{g['id']} {g['gym']} (hint: {g['account']})")

    # Check Camofox connectivity
    try:
        tabs = json.loads(urlopen(f"{CAMOFOX_BASE}/tabs?userId=xhs-climber-primary", timeout=5).read())
        print(f"\nCamofox check: {len(tabs.get('tabs', []))} tabs open")
    except Exception as e:
        print(f"\n⚠️  Camofox unreachable: {e}")
        print("Start Camofox before running this script, then retry.")
        sys.exit(1)

    proc, master_fd, send = start_mcp()
    print(f"MCP alive: {proc.poll() is None}")

    results = {}
    search_count = 0

    print(f"\n--- Starting batch search (cooldown={COOLDOWN_SECS}s between calls) ---")
    for i, gym in enumerate(to_search):
        gym_id = gym['id']
        gym_name = gym['gym']
        account_hint = gym['account']
        terms = build_search_terms(gym_name, account_hint)

        best = None
        for term in terms:
            print(f"[{i+1}/{len(to_search)}] Searching '{term}' for {gym_name}...", end=' ', flush=True)
            search_count += 1
            res = search_gym(send, master_fd, term)

            if res and res.get('ok') and res.get('candidates'):
                cands = res['candidates'][:3]
                print(f"✓ got {len(cands)} candidates")
                if not best:
                    best = {
                        'term': term,
                        'candidates': cands,
                        'actions': res.get('actions', []),
                    }
            else:
                status_note = ''
                if res:
                    acts = res.get('actions', [])[:3]
                    status_note = f" ({','.join(acts)})"
                print(f"✗ no candidates{status_note}")

            time.sleep(1)

            # Batch cooldown
            if search_count % BATCH_SIZE == 0:
                print(f"\n  ⏳ Batch limit ({search_count}), waiting {COOLDOWN_SECS}s...")
                time.sleep(COOLDOWN_SECS)

        results[gym_id] = best

    # Summary
    print("\n\n=== RESULTS ===")
    updates = []
    for gym in to_search:
        gym_id = gym['id']
        gym_name = gym['gym']
        best = results.get(gym_id)
        if best:
            cands = best['candidates']
            print(f"\n#{gym_id} {gym_name}:")
            for c in cands:
                print(f"  [{c['rank']}] {c['title'][:60]}")
                print(f"           url={c['url'][:80]}")
            # Pick the best candidate (first one)
            top = cands[0]
            updates.append({
                'id': gym_id,
                'account': top['title'],
                'url': top['url'],
            })
        else:
            print(f"\n#{gym_id} {gym_name}: NO RESULTS")

    # Write update suggestions
    if updates:
        print(f"\n\n=== UPDATE SUGGESTIONS (add to gym.shanghai.json) ===")
        print(json.dumps(updates, ensure_ascii=False, indent=2))

    # Cleanup
    try:
        os.close(master_fd)
    except: pass
    proc.terminate()
    proc.wait()
    print(f"\nDone. Searched {search_count} times.")


if __name__ == '__main__':
    main()