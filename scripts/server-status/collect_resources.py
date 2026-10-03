"""Collect approved lab resources with cached SSH authentication, never prompt."""
import base64
import concurrent.futures
import datetime as dt
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent
TOOLS = ROOT.parents[1] / 'tools'
sys.path.insert(0,str(TOOLS))
from inspect_slurm_accounting import summarize_observation
SSH = r'C:\Windows\System32\OpenSSH\ssh.exe'


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.pending')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(path)


def collect(host, remote_script, ssh_target=None, port=None, input_source=None, timeout=100):
    started = utcnow()
    command = [SSH, '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
               '-o', 'UpdateHostKeys=no', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
               '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=10',
               '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2',
               *(['-p',str(port)] if port else []), ssh_target or host, remote_script]
    record = {'host': host, 'local_started_at_utc': started, 'status': 'unreachable'}
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout,
                                encoding='utf-8', errors='replace',input=input_source)
        record['ssh_exit_code'] = result.returncode
        if result.returncode:
            # BatchMode prevents credential prompts; stderr contains connection errors only.
            record['error'] = result.stderr.strip()[-1200:]
        else:
            candidates = [line for line in result.stdout.splitlines() if line.startswith('{')]
            if len(candidates) != 1:
                raise ValueError('Expected exactly one JSON result')
            record.update(json.loads(candidates[0]))
            record['status'] = ('ok' if record.get('cluster_query_ok') else 'invalid') if record.get('kind')=='slurm_cluster' else 'ok'
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        record['error'] = str(error)
    record['local_completed_at_utc'] = utcnow()
    return record


def unavailable_master_storage():
    return {'status': 'unavailable', 'scope': 'sg_master_mounts',
            'checked_at_utc': utcnow(), 'disks': [], 'volumes': [],
            'low_space_filesystems': 0}


def collect_master_storage(cluster, source):
    """Keep optional mount queries outside the scheduler command's timeout."""
    wrapper = 'import contextlib,io,json\nsource=' + repr(source) + '\nstream=io.StringIO()\n'
    wrapper += 'with contextlib.redirect_stdout(stream):\n exec(compile(source,"storage","exec"),{"__name__":"__main__"})\n'
    wrapper += 'print(json.dumps({"storage":json.loads(stream.getvalue())}))\n'
    try:
        result = collect(cluster['host'], 'python3 -', cluster['ssh_target'],
                         cluster['ssh_port'], input_source=wrapper, timeout=30)
        storage = result.get('storage')
        if (result.get('status') == 'ok' and isinstance(storage, dict) and
                storage.get('scope') == 'sg_master_mounts' and
                storage.get('status') in ('ok', 'partial', 'unavailable') and
                isinstance(storage.get('volumes'), list)):
            return storage
    except Exception:
        # An optional parser/SSH failure must never suppress scheduler observations.
        pass
    return unavailable_master_storage()


def attach_master_storage(record, cluster):
    if cluster.get('host') != 'sg':
        return
    record['storage'] = unavailable_master_storage()
    try:
        source = (TOOLS / 'inspect_master_storage.py').read_text(encoding='utf-8')
        record.setdefault('collector_sha256', {})['storage'] = hashlib.sha256(source.encode()).hexdigest()
        record['storage'] = collect_master_storage(cluster, source)
    except Exception:
        # Missing optional helper or query failures leave an explicit unknown value.
        pass


def summarize(record):
    row = {key: record[key] for key in ('host', 'status', 'local_started_at_utc', 'local_completed_at_utc')}
    if record['status'] != 'ok':
        row['error'] = record.get('error', 'Unknown SSH error')
        if record.get('kind') == 'slurm_cluster' and 'storage' in record:
            row['storage'] = record['storage']
        return row
    if record.get('kind')=='slurm_cluster':
        result={k:v for k,v in record.items() if k not in ('collector_sha256','ssh_exit_code')}
        if 'usage' in result:result['usage']=summarize_observation(result['usage'])
        return result
    cpu = record['cpu']
    total = cpu['online_logical_cpus']
    sampled = cpu['sampled_logical_cpus']
    equivalent = sum(cpu[key] for key in ('idle_logical_cpu_equivalents',
                    'active_logical_cpu_equivalents', 'iowait_logical_cpu_equivalents'))
    if total <= 0 or sampled != total or abs(equivalent - sampled) > 1e-6:
        row.update(status='invalid', error='Incomplete or inconsistent CPU counters')
        return row
    row.update(physical_cores=cpu['online_physical_cores'], logical_cpus=total,
               idle_cpu_equivalent=cpu['idle_logical_cpu_equivalents'],
               cpu_idle_percent=100 * cpu['idle_logical_cpu_equivalents'] / total,
               cpu_active_percent=100 * cpu['active_logical_cpu_equivalents'] / total,
               cpu_sample_seconds=cpu['sample_seconds'],
               memory_total_gib=cpu['memory']['MemTotal_KiB'] / 1024**2,
               memory_available_gib=cpu['memory']['MemAvailable_KiB'] / 1024**2)
    row['cpu_threads'] = [{
        'logical_cpu': entry['logical_cpu'],
        'socket': entry.get('socket'), 'physical_core': entry.get('physical_core'),
        'utilization_percent': 100 * entry['active_fraction'],
        'iowait_percent': 100 * entry['iowait_fraction'],
        'programs': entry.get('programs', []) if entry['active_fraction'] >= .01 else []}
        for entry in cpu['per_cpu']]
    row['program_mapping'] = cpu.get('program_mapping', {})
    row['storage'] = record.get('storage', {'status':'unavailable','disks':[],'volumes':[]})
    scheduler = cpu['scheduler']
    row['scheduler_status'] = ('query_failed' if any(item.get('exit_code') != 0 for item in scheduler.values())
                               else 'query_succeeded' if scheduler else 'not_detected')
    gpu = record['gpu']
    row['gpu_query_ok'] = (gpu.get('nvidia_smi_xml', {}).get('exit_code') == 0
                           and not gpu.get('xml_parse_error') and bool(gpu['gpus']))
    row['gpus'] = []
    if row['gpu_query_ok']:
        inventory = {item['uuid']: item for item in gpu['gpus']}
        samples = gpu['samples']
        if len(samples) != 3 or any(sample['result'].get('exit_code') != 0 or
                {item['uuid'] for item in sample['gpus']} != set(inventory) for sample in samples):
            row['gpu_query_ok'] = False
            row['gpu_error'] = 'GPU samples or inventory inconsistent'
        else:
            for item in samples[-1]['gpus']:
                xml = inventory[item['uuid']]
                values = [next(entry for entry in sample['gpus'] if entry['uuid'] == item['uuid']) for sample in samples]
                rates = [float(entry['utilization.gpu']) for entry in values]
                memory_total = float(item['memory.total'])
                memory_free = float(item['memory.free'])
                if not 0 <= memory_free <= memory_total:
                    row['gpu_query_ok'] = False
                    row['gpu_error'] = 'GPU memory counters inconsistent'
                    row['gpus'] = []
                    break
                row['gpus'].append({
                    'index': int(item['index']), 'name': item['name'], 'uuid': item['uuid'],
                    'utilization_percent': sum(rates) / len(rates),
                    'utilization_min_percent': min(rates), 'utilization_max_percent': max(rates),
                    'memory_total_gib': memory_total / 1024,
                    'memory_free_gib': memory_free / 1024,
                    'memory_used_mib': float(item['memory.used']),
                    'temperature_c': float(item['temperature.gpu']),
                    'power_w': float(item['power.draw']),
                    'processes': [{'name': pathlib.PurePosixPath(process.get('process_name', '')).name,
                                   'type': process.get('type'), 'memory': process.get('used_memory')}
                                  for process in xml['processes']],
                    'driver': item['driver_version']})
    else:
        row['gpu_error'] = gpu.get('nvidia_smi_xml', {}).get('stderr') or 'NVIDIA GPU query unavailable'
    return row


def main():
    config = json.loads((ROOT / 'config.json').read_text(encoding='utf-8-sig'))
    sources = {name: (TOOLS / ('inspect_' + name + '_resources.py')).read_text(encoding='utf-8')
               for name in ('cpu', 'gpu', 'storage')}
    # Use existing reviewed collectors. Keep unattended scheduler-query waits bounded.
    sources['cpu'] = sources['cpu'].replace('timeout=20)', 'timeout=5)')
    wrapper = 'import contextlib,io,json\nsources=' + repr(sources) + '\nresult={}\n'
    wrapper += 'for kind,source in sources.items():\n stream=io.StringIO()\n with contextlib.redirect_stdout(stream):\n  exec(compile(source,kind,"exec"),{"__name__":"__main__"})\n result[kind]=json.loads(stream.getvalue())\nprint(json.dumps(result,ensure_ascii=True))\n'
    payload = base64.b64encode(wrapper.encode()).decode()
    remote_script = 'echo ' + payload + ' | base64 -d | python3'
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    archive = ROOT / 'snapshots' / stamp
    archive.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        records = list(pool.map(lambda host: collect(host, remote_script), config['hosts']))
    cluster_records=[]
    for cluster in config.get('clusters',[]):
        sources_sg={name:(TOOLS/('inspect_slurm_'+name+'.py')).read_text(encoding='utf-8') for name in ('resources','accounting','job_counter')}
        source='import contextlib,io,json\nsources='+repr(sources_sg)+'\nresults={}\n'
        source+='for name,source in sources.items():\n stream=io.StringIO()\n with contextlib.redirect_stdout(stream):\n  exec(compile(source,name,"exec"),{"__name__":"__main__"})\n results[name]=json.loads(stream.getvalue())\nresult=results["resources"]\nresult["usage"]=results["accounting"]\nresult["job_counter"]=results["job_counter"]\nprint(json.dumps(result))\n'
        record=collect(cluster['host'],'python3 -',cluster['ssh_target'],cluster['ssh_port'],input_source=source)
        record['kind']='slurm_cluster'
        if record['status']=='ok' and record.get('node_count')!=cluster['expected_nodes']:
            record.update(status='invalid',error='Unexpected Slurm node inventory')
        record['collector_sha256']={name:hashlib.sha256(s.encode()).hexdigest() for name,s in sources_sg.items()}
        attach_master_storage(record, cluster)
        cluster_records.append(record)
    latest = {'checked_at_utc': utcnow(), 'servers': [], 'clusters': []}
    history_path = ROOT / 'history.json'
    history = json.loads(history_path.read_text(encoding='utf-8-sig')) if history_path.exists() else []
    for record in records:
        record['collector_sha256'] = {name: hashlib.sha256(source.encode()).hexdigest()
                                      for name, source in sources.items()}
        write_json(archive / (record['host'] + '.json'), record)
        row = summarize(record)
        row['run_id'] = stamp
        latest['servers'].append(row)
        if not any(previous.get('run_id') == stamp and previous['host'] == row['host'] for previous in history):
            history.append(row)
    for record in cluster_records:
        write_json(archive/(record['host']+'.json'),record)
        row=summarize(record);row['run_id']=stamp;row['kind']='slurm_cluster'
        latest['clusters'].append(row)
        if not any(previous.get('run_id')==stamp and previous['host']==row['host'] for previous in history):history.append(row)
    # Keep dashboard history for 30 days; raw archives remain available locally.
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)
    history = [row for row in history if dt.datetime.fromisoformat(row['local_completed_at_utc']) >= cutoff]
    write_json(history_path, history)
    write_json(ROOT / 'latest.json', latest)
    print(json.dumps({'run_id': stamp, 'servers': latest['servers'], 'clusters':latest['clusters']}, ensure_ascii=True))


if __name__ == '__main__':
    main()
