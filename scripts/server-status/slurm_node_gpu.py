"""Optional, bounded read-only GPU sampling on explicitly configured Slurm nodes."""
import datetime as dt,json,math,pathlib,re

def observation(raw, expected):
    failed={'status':'failed','checked_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'gpus':[]}
    try:
        if raw.get('nvidia_smi_xml',{}).get('exit_code')!=0 or raw.get('xml_parse_error'):return failed
        inventory=raw['gpus'];samples=raw['samples']
        ids={g['uuid'] for g in inventory}
        if len(inventory)!=expected or len(ids)!=expected or len(samples)!=3:return failed
        if any(s['result'].get('exit_code')!=0 or len(s['gpus'])!=expected or {g['uuid'] for g in s['gpus']}!=ids for s in samples):return failed
        stamp=raw['completed_at_utc'];parsed=dt.datetime.fromisoformat(stamp.replace('Z','+00:00'))
        if parsed.tzinfo is None:return failed
        if not -300 <= (dt.datetime.now(dt.timezone.utc)-parsed).total_seconds() <= 300:return failed
        out=[]
        for last in samples[-1]['gpus']:
            rates=[float(next(g for g in s['gpus'] if g['uuid']==last['uuid'])['utilization.gpu']) for s in samples]
            total,free,used=[float(last[k]) for k in ['memory.total','memory.free','memory.used']]
            if not all(math.isfinite(v) for v in [*rates,total,free,used]) or not total>0 or not 0<=free<=total or not 0<=used<=total or not all(0<=v<=100 for v in rates):return failed
            xml=next(g for g in inventory if g['uuid']==last['uuid'])
            index=int(last['index'])
            if index<0 or str(index)!=str(last['index']):return failed
            out.append({'index':index,'name':str(last['name'])[:128], 'memory_total_gib':total/1024,'memory_free_gib':free/1024,'utilization_percent':sum(rates)/3,
                        'processes':[{'name':pathlib.PurePosixPath(p.get('process_name') or 'Unknown').name[:64]} for p in xml.get('processes',[])]})
        if len({g['index'] for g in out})!=expected:return failed
        return {'status':'ok','checked_at_utc':stamp,'gpus':out}
    except (KeyError,ValueError,TypeError,StopIteration,OverflowError):return failed

def master_source(node,gpu_source):
    if not re.fullmatch(r'SG\d{2}',node):raise ValueError('Invalid configured GPU node')
    argv=['ssh','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UpdateHostKeys=no','-o','ForwardAgent=no','-o','ForwardX11=no','-o','ClearAllForwardings=yes','-o','ConnectTimeout=8','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=1',node,'python3 -']
    return ('import json,subprocess\n'
      'try:\n p=subprocess.run('+repr(argv)+',input='+repr(gpu_source)+',capture_output=True,text=True,timeout=65)\n lines=[s for s in p.stdout.splitlines() if s.startswith("{")]\n result=json.loads(lines[0]) if p.returncode==0 and len(lines)==1 else {}\n'
      'except (OSError,ValueError,subprocess.TimeoutExpired):result={}\n'
      'print(json.dumps({"node_gpu":result}))\n')

def attach(record,cluster,collect,gpu_source):
    if record.get('status')!='ok':return
    configured=cluster.get('gpu_nodes',[])
    if configured!=['SG11']:return  # Scope is intentionally limited to the approved SG11 node.
    for node in record.get('nodes',[]):
        if node['name'] not in configured:continue
        failed={'status':'failed','checked_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'gpus':[]}
        node['gpu_observation']=failed
        try:
            r=collect(cluster['host'],'python3 -',cluster['ssh_target'],cluster['ssh_port'],input_source=master_source(node['name'],gpu_source),timeout=80)
            record.setdefault('node_gpu_raw',{})[node['name']]=r
            raw=r.get('node_gpu',{})
            if r.get('status')=='ok' and raw.get('hostname')==node['name']:node['gpu_observation']=observation(raw,node.get('configured_gpus'))
        except Exception:pass  # GPU failure cannot suppress the scheduler or job observations.
    gpu_nodes=[n for n in record.get('nodes',[]) if n.get('configured_gpus')]
    record['gpu_query_ok']=bool(gpu_nodes) and all(n.get('gpu_observation',{}).get('status')=='ok' for n in gpu_nodes)
