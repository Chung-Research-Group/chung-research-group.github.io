"""Read /proc/meminfo once on each explicitly approved compute node, without sudo."""
import datetime as dt
import json
import re

NODE_SOURCE = r'''
import datetime,json,socket
values={}
with open('/proc/meminfo') as stream:
 for line in stream:
  parts=line.split()
  if parts[0] in ('MemTotal:','MemAvailable:') and len(parts)==3 and parts[2]=='kB':
   values[parts[0][:-1]]=int(parts[1])*1024
print(json.dumps({'hostname':socket.gethostname().split('.')[0],
 'checked_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'total_bytes':values.get('MemTotal'),'available_bytes':values.get('MemAvailable')}))
'''


def master_source(nodes):
    if len(nodes) != len(set(nodes)) or not nodes or any(not re.fullmatch(r'SG\d{2}', n) for n in nodes):
        raise ValueError('Invalid compute-node inventory')
    argv = ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'UpdateHostKeys=no', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
            '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=8',
            '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=1']
    return ('import concurrent.futures,json,subprocess\n'
            'nodes=' + repr(nodes) + '\nargv=' + repr(argv) + '\nsource=' + repr(NODE_SOURCE) + '\n' +
            'def sample(node):\n'
            ' try:\n'
            '  p=subprocess.run(argv+[node,"python3 -"],input=source,capture_output=True,text=True,timeout=35)\n'
            '  lines=[s for s in p.stdout.splitlines() if s.startswith("{")]\n'
            '  raw=json.loads(lines[0]) if p.returncode==0 and len(lines)==1 else {}\n'
            '  error=None if raw else p.stderr[-600:]\n'
            ' except (OSError,ValueError,subprocess.TimeoutExpired) as exc:raw={};error=type(exc).__name__\n'
            ' return {"node":node,"observation":raw,"error":error}\n'
            'with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:\n'
            ' results=list(pool.map(sample,nodes))\n'
            'print(json.dumps({"node_memory":results}))\n')


def observation(raw, node, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    failed = {'status': 'failed', 'checked_at_utc': now.isoformat()}
    try:
        stamp = dt.datetime.fromisoformat(raw['checked_at_utc'].replace('Z', '+00:00'))
        total, available = raw['total_bytes'], raw['available_bytes']
        if (raw['hostname'] != node or stamp.tzinfo is None or
                not -300 <= (now - stamp).total_seconds() <= 300 or
                type(total) is not int or type(available) is not int or
                not 0 <= available <= total or total <= 0):
            return failed
        return {'status': 'ok', 'checked_at_utc': stamp.isoformat(),
                'total_bytes': total, 'available_bytes': available}
    except (KeyError, TypeError, ValueError, OverflowError):
        return failed


def normalize(record, expected, rows, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    # Never turn a missing/duplicate/misidentified node into a zero or a full sum.
    inventory = [n['name'] for n in record.get('nodes', [])]
    valid_inventory = (len(expected) == len(set(expected)) == len(inventory) == len(set(inventory))
                       and set(expected) == set(inventory))
    rows = rows if isinstance(rows, list) else []
    observed = []
    for n in record.get('nodes', []):
        matches = [r.get('observation', {}) for r in rows if isinstance(r, dict) and r.get('node') == n['name']]
        raw = matches[0] if valid_inventory and len(matches) == 1 else {}
        n['memory_observation'] = observation(raw, n['name'], now)
        if n['memory_observation']['status'] != 'ok':
            n['memory_observation']['reason'] = 'unavailable'
        if n['memory_observation']['status'] == 'ok':
            observed.append(n['memory_observation'])
    complete = valid_inventory and len(observed) == len(expected) and bool(expected)
    record['memory_observation'] = {
        'status': 'ok' if complete else 'partial' if observed else 'failed',
        'checked_at_utc': now.isoformat(), 'expected_count': len(expected), 'observed_count': len(observed),
        'total_bytes': sum(n['total_bytes'] for n in observed) if complete else None,
        'available_bytes': sum(n['available_bytes'] for n in observed) if complete else None,
        'observed_total_bytes': sum(n['total_bytes'] for n in observed) if observed else None,
        'observed_available_bytes': sum(n['available_bytes'] for n in observed) if observed else None}


def attach(record, cluster, collect):
    expected = cluster.get('memory_nodes', [])
    if record.get('status') != 'ok' or expected != ['SG%02d' % i for i in range(1, 17)]:
        return
    rows = []
    query_nodes = cluster.get('memory_query_nodes', expected)
    if not query_nodes or len(query_nodes) != len(set(query_nodes)) or not set(query_nodes) <= set(expected):
        normalize(record, expected, [])
        return
    try:
        result = collect(cluster['host'], 'python3 -', cluster['ssh_target'], cluster['ssh_port'],
                         input_source=master_source(query_nodes), timeout=165)
        if result.get('status') == 'ok':
            rows = result.get('node_memory', [])
    except Exception:
        pass  # Optional OS observations cannot suppress scheduler observations.
    normalize(record, expected, rows)
    for node in record.get('nodes', []):
        reason = cluster.get('memory_access_blocked', {}).get(node['name'])
        if reason in ('access_policy', 'host_key_unverified') and node['memory_observation']['status'] != 'ok':
            node['memory_observation']['reason'] = reason
