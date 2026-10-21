"""Read-only scheduler inventory; never samples or launches node workloads."""
import collections,datetime,json,os,pathlib,re,subprocess


def number(value):
    try:n=int(value);return n if n>=0 else None
    except (ValueError,TypeError):return None


def pairs(line):
    found=list(re.finditer(r'(?:^|\s)([A-Za-z][A-Za-z0-9_]*)=',line))
    return {m.group(1):line[m.end():found[i+1].start() if i+1<len(found) else len(line)].strip() for i,m in enumerate(found)}


def hosts(expression):
    """Expand only bounded Slurm hostlists; no per-job controller requests."""
    if not expression or expression in ('(null)','N/A','None'):return []
    groups=re.split(r',(?=[^\]]*(?:\[|$))',expression);result=[]
    def expand(term):
        m=re.search(r'\[([^\]]+)\]',term)
        if not m:return [term] if re.fullmatch(r'[A-Za-z0-9_.-]+',term) else []
        entries=[]
        for part in m.group(1).split(','):
            if re.fullmatch(r'\d+-\d+',part):
                start,end=part.split('-');a,b=int(start),int(end)
                if b<a or b-a>4096:return []
                entries.extend(str(i).zfill(len(start)) for i in range(a,b+1))
            elif re.fullmatch(r'\d+',part):entries.append(part)
            else:return []
        output=[]
        for entry in entries:
            output.extend(expand(term[:m.start()]+entry+term[m.end():]))
            if len(output)>4096:return []
        return output
    for group in groups:
        result.extend(expand(group))
        if len(result)>4096:return []
    return list(dict.fromkeys(result))


def gpu_count(value):
    if value in ('(null)','N/A','None',''):return 0 if value=='(null)' else None
    counts=[]
    for entry in re.split(r',\s*(?![^()]*\))', value):
        plain=entry.split('(')[0]
        if not plain.startswith('gpu:'):continue
        n=number(plain.rsplit(':',1)[-1])
        if n is None:return None
        counts.append(n)
    return sum(counts)


def allocated_gpu(raw, configured):
    # GresUsed is controller allocation, independent of NVML activity and TRES accounting.
    text = raw.get('GresUsed')
    used = gpu_count(text) if isinstance(text,str) and (text == '(null)' or re.search(r'(?:^|,)gpu:',text)) else None
    entries = [number(v.split('=', 1)[1]) for v in raw.get('AllocTRES','').split(',') if v.startswith('gres/gpu=')]
    tres = entries[0] if len(entries) == 1 else None
    if used is not None and tres is not None and used != tres:return None
    value = used if used is not None else tres
    if value is None and configured == 0:return 0
    return value if value is not None and configured is not None and 0 <= value <= configured else None

def memory_tracking(parameters):
    if not isinstance(parameters,str) or not parameters:return None
    flags={v.strip().upper() for v in parameters.split(',')}
    if flags & {'CR_MEMORY','CR_CPU_MEMORY','CR_CORE_MEMORY','CR_SOCKET_MEMORY'}:return True
    if flags & {'CR_CPU','CR_CORE','CR_SOCKET'}:return False
    return None


def label(value):
    value=pathlib.PurePosixPath(value.replace('\\','/')).name
    if re.search(r'(?:ntn_|secret_)[A-Za-z0-9_-]{20,}',value):return 'job'
    return value[:64]


def normalize(node_text,queue_text,sinfo_text,query_ok):
    nodes={};invalid=0
    for line in node_text.splitlines():
        raw=pairs(line);name=raw.get('NodeName','')
        if not re.fullmatch(r'[A-Za-z0-9_.-]+',name):invalid+=1;continue
        if name in nodes:invalid+=1;continue
        total,allocated=number(raw.get('CPUTot')),number(raw.get('CPUAlloc'))
        if total is None or allocated is None or allocated>total:allocated=None
        state=raw.get('State','UNKNOWN')
        if not re.fullmatch(r'[A-Za-z_+*~#$@%\-]+',state):state='UNKNOWN'
        memory=number(raw.get('RealMemory'));mem_alloc=number(raw.get('AllocMem'))
        free=number(raw.get('FreeMem'))
        if memory is None or mem_alloc is not None and mem_alloc>memory:mem_alloc=None
        if free is not None and memory is not None and free>memory:free=None
        offline=any(x in state.upper() for x in ('DOWN','FAIL','UNKNOWN','NOT_RESPONDING','NO_RESP','INVALID_REG','FUTURE'))
        if offline:free=None
        configured_gpu=gpu_count(raw.get('Gres',''))
        gpu_alloc=allocated_gpu(raw, configured_gpu)
        nodes[name]={'name':name,'state':state,'slurm_cpus_total':total,'slurm_cpus_allocated':allocated,
          'sockets':number(raw.get('Sockets')),'cores_per_socket':number(raw.get('CoresPerSocket')),
          'threads_per_core':number(raw.get('ThreadsPerCore')),'partitions':[],
          'memory_total_bytes':memory*1048576 if memory is not None else None,
          'memory_allocated_bytes':mem_alloc*1048576 if mem_alloc is not None else None,
          'slurm_free_memory_bytes':free*1048576 if free is not None else None,
          'memory_available_bytes':None,'cpu_utilization_percent':None,'gpu_utilization_percent':None,
          'configured_gpus':configured_gpu,'allocated_gpus':gpu_alloc,'job_labels':[]}
    info_names=set()
    for line in sinfo_text.splitlines():
        columns=[v.strip() for v in line.split('|')]
        if len(columns)!=6:continue
        name,partition,state,cpus,memory,gres=columns
        for node_name in hosts(name):
            info_names.add(node_name)
            if node_name in nodes:
                partition=partition.rstrip('*')
                if re.fullmatch(r'[A-Za-z0-9_.-]+',partition) and partition not in nodes[node_name]['partitions']:nodes[node_name]['partitions'].append(partition)
    jobs=[];job_states=collections.Counter();seen=set();invalid_jobs=0
    for line in queue_text.splitlines():
        columns=[v.strip() for v in line.split('|')]
        if len(columns)!=7:invalid_jobs+=1;continue
        job_id,name,state,partition,cpus,node_count,node_list=columns
        if not re.fullmatch(r'[0-9_\[\],%.:+-]+',job_id) or not re.fullmatch(r'[A-Z_]+',state):invalid_jobs+=1;continue
        if job_id in seen:continue
        seen.add(job_id);job_states[state]+=1
        names=[n for n in hosts(node_list) if n in nodes]
        job={'id':job_id[:80],'name':label(name),'state':state,'partition':label(partition),
             'slurm_cpus':number(cpus),'node_count':number(node_count),'nodes':names}
        jobs.append(job)
        if state in ('RUNNING','COMPLETING','SUSPENDED'):
            for n in names:
                if len(nodes[n]['job_labels'])<5:nodes[n]['job_labels'].append({'id':job['id'],'name':job['name'],'state':state})
    ordered=sorted(nodes.values(),key=lambda n:n['name'])
    def aggregate(key):
        values=[n[key] for n in ordered]
        return sum(values) if values and all(v is not None for v in values) else None
    node_ok=query_ok.get('nodes',False) and bool(nodes) and invalid==0
    coverage_ok=query_ok.get('sinfo',False) and info_names==set(nodes)
    query_ok=dict(query_ok);query_ok['queue']=bool(query_ok.get('queue') and not invalid_jobs)
    if not query_ok['queue']:
        jobs=[];job_states.clear()
        for node in ordered:node['job_labels']=[]
    jobs.sort(key=lambda j:(0 if j['state']=='RUNNING' else 1,j['id']))
    result={'kind':'slurm_cluster','cluster_query_ok':node_ok and coverage_ok,'query_ok':query_ok,
      'nodes':ordered,'node_count':len(ordered),'node_states':dict(collections.Counter(n['state'] for n in ordered)),
      'nodes_with_allocations':sum(n['slurm_cpus_allocated']>0 for n in ordered if n['slurm_cpus_allocated'] is not None) if node_ok else None,
      'slurm_cpus_total':aggregate('slurm_cpus_total'),'slurm_cpus_allocated':aggregate('slurm_cpus_allocated') if node_ok else None,
      'memory_total_bytes':aggregate('memory_total_bytes'),'memory_allocated_bytes':aggregate('memory_allocated_bytes'),
      'slurm_free_memory_bytes':aggregate('slurm_free_memory_bytes'),'memory_available_bytes':None,
      'configured_gpus':aggregate('configured_gpus'),'allocated_gpus':aggregate('allocated_gpus'),
      'cpu_utilization_percent':None,'gpu_utilization_percent':None,'gpu_query_ok':False,
      'visible_job_count':len(jobs) if query_ok.get('queue') else None,
      'job_states':dict(job_states) if query_ok.get('queue') else {},'jobs':jobs[:30],'jobs_truncated':len(jobs)>30,
      'sample_note':'Slurm allocation and OS-reported FreeMem only. No per-core, GPU utilization/VRAM or MemAvailable samples. Job names are scheduler labels, not sampled executables.'}
    return result


def run(argv):
    try:
        env={k:v for k,v in os.environ.items() if not k.startswith('SQUEUE_')};env['LC_ALL']='C'
        proc=subprocess.run(argv,capture_output=True,text=True,timeout=15,env=env)
        return proc.returncode==0,proc.stdout if proc.returncode==0 else ''
    except (OSError,subprocess.TimeoutExpired):return False,''


def main():
    start=datetime.datetime.now(datetime.timezone.utc).isoformat()
    ok_nodes,node_text=run(['scontrol','--oneliner','--details','show','nodes'])
    ok_queue,queue_text=run(['squeue','--local','--all','--noheader','--array','--format=%i|%.80j|%T|%P|%C|%D|%N'])
    ok_info,info_text=run(['sinfo','--Node','--noheader','--format=%N|%P|%T|%c|%m|%G'])
    result=normalize(node_text,queue_text,info_text,{'nodes':ok_nodes,'queue':ok_queue,'sinfo':ok_info})
    ok_config,config_text=run(['scontrol','show','config'])
    parameters=next((line.split('=',1)[1].strip() for line in config_text.splitlines() if line.strip().startswith('SelectTypeParameters ') and '=' in line),None) if ok_config else None
    result['memory_allocation_tracked']=memory_tracking(parameters)
    result.update(started_at_utc=start,checked_at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat())
    print(json.dumps(result,ensure_ascii=True))


if __name__=='__main__':main()
