"""Language support for the public dashboard; no collection or publishing I/O."""
import json
from dashboard_languages import ZH, FA, STATES_ZH, STATES_FA, RETENTION_UNITS, RTL_CSS


KO = {
    'sharedHostScope': '공유 호스트의 CPU·RAM·GPU 관측값입니다. 연구실에서 GPU {count}개를 모두 사용할 수 있습니다.',
    'title': '서버 자원 현황', 'cpu': '관측된 사용 중 코어',
    'sampleNote': '관측된 활동을 표시하며, 스케줄러 예약량은 아닙니다.',
    'unknown': '현재 상태를 확인할 수 없습니다',
    'noName': '프로그램 정보 없음', 'noCores': '코어별 관측 정보 없음',
    'failed': '조회 실패 · 현재 상태 미확인', 'stale': '관측 유효 시간 초과 · 현재 상태 미확인',
    'jobCounter': '최근 관측 작업 ID',
    'jobCounterNote': '최근 7일간 전체 사용자의 작업 이력에서 확인한 가장 최근 제출 ID입니다. 전체 누적 작업 수는 아닙니다.',
    'jobIdLimit': 'ID 순환 상한', 'cumulativeReview': '',
    'cpuCriterion': '표본에서 SMT 스레드 하나라도 CPU 활성 시간이 1% 이상이면 물리 코어를 한 번 셉니다. 관측된 활동이며 스케줄러 할당량은 아닙니다. 카운터나 코어 구성 정보가 없으면 미확인으로 표시합니다.',
    'gpuCriterion': '관측된 계산 또는 MPS 컨텍스트가 있는 GPU 수입니다. 데스크톱·그래픽 전용 세션은 제외합니다. 예약량이 아니며 불완전한 관측은 미확인으로 표시합니다.',
    'available': '사용 가능', 'usage_unknown': '사용량 확인 불가',
    'storageWarning': '사용 가능 공간이 10% 미만이거나, 20 GB 이상 파일시스템에서 20 GB 미만이면 경고합니다. 사용 가능 용량은 예약 공간을 제외합니다.',
    'topology': '설정된 CPU 구성', 'notSampled': '관측 정보 없음',
    'osFree': '운영체제 여유 메모리 (Slurm FreeMem)',
    'allTop5': '보존 기록 상위 5명', 'lastMonthTop3': '지난달 상위 3명',
    'rankingScope': '사용자별 순위 · 현재 보존된 기록만 집계하며 전체 기간의 이력은 아닙니다.',
    'usageMetric': '실제로 시작한 고유 작업 할당 건수이며 CPU 사용 시간은 아닙니다. 배열 작업은 요소별로 한 번씩 셉니다. 작업 단계, batch/extern 및 재대기 기록은 추가 집계하지 않습니다. 월은 보존된 기록 중 최초 실제 시작 시각의 KST 기준입니다.',
    'notLifetime': '일부 작업 이력입니다. 이전에 삭제되거나 별도 보관된 기록은 조회하지 않았으며, 어느 월도 완전한 기록으로 보증하지 않습니다.',
    'allUsers': '전체 사용자 조회 확인: --allusers 및 컨트롤러/데이터베이스의 PrivateData=none.',
    'usageUnavailable': '작업 이력 조회 실패 · 과거 기록 미확인',
    'requeuesRemoved': '재대기 중복 기록 제외', 'noStartRemoved': '실제 시작하지 않은 기록 제외',
    'purgeCaveat': '최초 시도 기록이 삭제됐다면 보존된 시작 시각은 원래 시작 시각과 다릅니다. 같은 작업·사용자의 선행 노드 장애(NODE_FAIL), 선점(PREEMPTED), 재대기(REQUEUED) 기록을 재대기 연결 근거로 사용합니다. 같은 사용자에게 재사용된 ID는 이력 검증이 필요합니다.',
    'lineageBounds': '추정 재대기 연결이 ID 재사용이었을 때의 보존 기록 건수 범위',
    'slurmUser': '사용자', 'step': '작업 단계', 'networkVolume': '네트워크 볼륨',
    'unknownValue': '미확인', 'bytesNote': 'GB = 10⁹ bytes · TB = 10¹² bytes',
    'masterStorage': 'SG-Master 저장 공간',
    'masterStorageScope': 'SG-Master에 마운트된 파일시스템입니다. 계산 노드의 로컬 디스크는 조회하지 않았습니다.',
    'sharedStorage': '공유 저장소', 'localStorage': 'SG-Master 로컬 파일시스템',
    'otherStorage': '유형 미확인', 'localFilesystem': '로컬 파일시스템',
    'storageObserved': '디스크 관측 시각',
    'storageStale': '디스크 관측 유효 시간 초과 · 현재 용량 미확인',
    'storageTimeUnknown': '디스크 관측 시각 미확인 · 현재 용량 미확인',
    'storageQueryFailed': '디스크 조회 실패 · 현재 용량 미확인',
    'usagePercent': '사용률',
    'usagePercentNote': '사용률은 df 기준으로 100 × 사용량 ÷ (사용량 + 사용자 가용량)을 올림한 백분율입니다. 예약 공간 때문에 전체 용량에서 사용량을 뺀 값과 사용자 가용량이 다를 수 있습니다.',
    'storageAliasesNote': '동일한 파일시스템의 마운트 경로는 한 행에 묶어 표시하며, 중복 합산하지 않습니다.',
}
EN = {'sharedHostScope': 'CPU, RAM and GPU observations cover the shared host. The lab may use all {count} GPUs.',
      'step': 'step', 'networkVolume': 'Network volume', 'unknownValue': 'Unknown',
      'bytesNote': 'GB = 10⁹ bytes · TB = 10¹² bytes',
      'masterStorage': 'SG-Master storage',
      'masterStorageScope': 'Filesystems mounted on SG-Master. Compute-node local disks were not queried.',
      'sharedStorage': 'Shared storage', 'localStorage': 'SG-Master local filesystems',
      'otherStorage': 'Unclassified', 'localFilesystem': 'Local filesystem',
      'storageObserved': 'Storage observed',
      'storageStale': 'Storage observation expired; current capacity unknown',
      'storageTimeUnknown': 'Storage observation time unknown; current capacity unknown',
      'storageQueryFailed': 'Storage query unavailable; current capacity unknown',
      'usagePercent': 'Use%',
      'usagePercentNote': 'Use% follows df: 100 × used / (used + user available), rounded up. Reserved space can make total minus used differ from user-available space.',
      'storageWarning': 'User available below 10%, or below 20 GB on filesystems of at least 20 GB; user-available space excludes reserved blocks.',
      'storageAliasesNote': 'Mount paths on the same filesystem share one row and are never added together.'}

STATES_KO = {
    'RUNNING': '실행 중', 'PENDING': '대기', 'COMPLETING': '종료 처리 중',
    'COMPLETED': '완료', 'CONFIGURING': '설정 중', 'CANCELLED': '취소됨',
    'FAILED': '실패', 'TIMEOUT': '시간 초과', 'SUSPENDED': '일시 중단',
    'NODE_FAIL': '노드 장애', 'PREEMPTED': '선점됨', 'REQUEUED': '재대기',
    'OUT_OF_MEMORY': '메모리 부족', 'BOOT_FAIL': '부팅 실패', 'DEADLINE': '기한 초과',
    'REQUEUE_FED': '연합 재대기', 'REQUEUE_HOLD': '재대기 보류', 'RESIZING': '크기 조정 중',
    'REVOKED': '취소됨', 'SIGNALING': '신호 전달 중', 'SPECIAL_EXIT': '특수 종료',
    'STAGE_OUT': '출력 전송 중', 'STOPPED': '중지됨',
    'IDLE': '유휴', 'ALLOCATED': '할당됨', 'MIXED': '일부 할당', 'DOWN': '중단',
    'DRAIN': '할당 중지', 'DRAINED': '할당 중지', 'DRAINING': '작업 종료 대기',
    'FAIL': '장애', 'FAILING': '장애 처리 중', 'FUTURE': '향후 사용', 'UNKNOWN': '미확인',
    'MAINT': '유지보수', 'RESERVED': '예약됨', 'PERFCTRS': '성능 카운터 사용 중',
    'PLANNED': '계획됨', 'INVALID_REG': '등록 정보 오류', 'NOT_RESPONDING': '응답 없음',
    'POWER_DOWN': '전원 끄기 대기', 'POWERED_DOWN': '전원 꺼짐',
    'POWERING_DOWN': '전원 끄는 중', 'POWER_UP': '전원 켜기 대기', 'POWERING_UP': '전원 켜는 중',
    'REBOOT_REQUESTED': '재부팅 요청됨', 'REBOOT_ISSUED': '재부팅 중',
}


def bilingual_template(html, localize):
    def replace(before, after):
        nonlocal html
        if html.count(before) != 1:
            raise ValueError('Bilingual template drift: ' + before[:70])
        html = html.replace(before, after, 1)

    labels = {'en': {**localize.EN, **EN}, 'ko': {**localize.KO, **KO}, 'zh': ZH, 'fa': FA}
    for code, dictionary in labels.items():
        if dictionary.keys() != labels['en'].keys():
            raise ValueError('Dashboard dictionary keys differ: ' + code)
    encoded = json.dumps(labels, ensure_ascii=False).replace('<', '\\u003c')
    start = html.index('const labels=')
    end = html.index(';\nconst data=', start)
    html = html[:start] + 'const dictionaries=' + encoded + ";\nlet language='en',labels=dictionaries.en" + html[end:]
    replace("new Intl.DateTimeFormat('en-GB',", "new Intl.DateTimeFormat({en:'en-GB',ko:'ko-KR',zh:'zh-CN',fa:'fa-IR-u-ca-gregory-nu-latn'}[language],")
    replace(".format(new Date(s)):'Unknown';", ".format(new Date(s)):labels.unknownValue;")
    replace('<th>User</th>', "<th>'+esc(labels.slurmUser)+'</th>")
    replace("+' · step '+", "+' · '+esc(labels.step)+' '+")
    replace("esc(cfg.PurgeJobAfter||'?')", "esc(retentionText(cfg.PurgeJobAfter))")
    replace("esc(cfg.PurgeStepAfter||'?')", "esc(retentionText(cfg.PurgeStepAfter))")
    html = html.replace('esc(n.state)', 'esc(stateText(n.state))').replace('esc(j.state)', 'esc(stateText(j.state))')
    replace('esc(st)+\' \'+n', 'esc(stateText(st))+\' \'+n')
    # Only translate generated placeholder labels; never translate host, user, job or program names.
    replace('esc(d.device)', 'esc(volumeText(d.device))')
    replace('esc(d.media)', "esc(/^unknown$/i.test(d.media)?labels.unknownValue:d.media)")
    replace("esc(v.mounts?.length?v.mounts.join(' · '):v.device||labels.unknown)", "esc(v.mounts?.length?v.mounts.map(volumeText).join(' · '):volumeText(v.device)||labels.unknown)")
    replace('v.mounts?.length?v.device:null', 'v.mounts?.length?volumeText(v.device):null')
    # Missing-name markers distinguish generated placeholders from literal IDs
    # or executable names such as "Unknown", which must remain unchanged.
    html = html.replace('esc(x.name)', "esc(namedText(x))").replace('esc(j.name)', 'esc(namedText(j))')
    html = html.replace('esc(j.id)', "esc(j.id_missing?labels.unknownValue:j.id)")
    html = html.replace("j.name+' #'+j.id", "namedText(j)+' #'+(j.id_missing?labels.unknownValue:j.id)")
    html = html.replace('map(j=>j.name)', 'map(j=>namedText(j))')
    replace("t.programs.join(' · ')", "threadPrograms(t).join(' · ')")
    replace('flatMap(t=>t.programs||[])', 'flatMap(threadPrograms)')
    replace('g.processes.map(p=>p.name)', 'g.processes.map(p=>namedText(p,labels.noName))')
    replace("byId('storage').hidden=true;byId('sockets').className='node-grid'", "renderMasterStorage(s.latest);byId('sockets').className='node-grid'")
    replace("renderStorage(null);byId('core-heading')", "if(s.host==='sg')renderMasterStorage(s.latest);else renderStorage(null);byId('core-heading')")
    replace('<span>GB = 10⁹ bytes · TB = 10¹² bytes</span>', '<span id="units-note"></span>')
    replace('<noscript>JavaScript required.</noscript>', '<noscript>JavaScript required. / JavaScript를 활성화해 주세요. / 请启用 JavaScript。 / لطفاً JavaScript را فعال کنید.</noscript>')
    replace("i+(e.key==='ArrowRight'?1:servers.length-1)", "i+((e.key==='ArrowRight')!==(language==='fa')?1:servers.length-1)")
    replace('</style>', RTL_CSS + '</style>')
    # Long Korean help and scheduler explanations must wrap on narrow screens.
    replace('</style>', '.core-head{flex-wrap:wrap}.legend{white-space:normal}.node-top{flex-wrap:wrap}.node-detail,.gpu-name,.cluster-note{overflow-wrap:anywhere}.node:focus-visible{outline:3px solid var(--focus);outline-offset:2px}.storage .master-storage-table th:first-child,.storage .master-storage-table td:first-child{width:36%}.storage .master-storage-table th:last-child{width:13%}.master-storage-group{margin:16px 0 6px;font-size:12px}.master-storage-meta{margin:6px 0;font-size:11px;color:var(--muted)}.master-storage-table caption{text-align:left;font-weight:600;font-size:12px;margin:14px 0 5px}.master-storage-table .mount-alias{display:block;overflow-wrap:anywhere}@media(max-width:500px){.storage .master-storage-table{font-size:10px}.storage .master-storage-table th{font-size:9px}.storage .master-storage-table th:first-child,.storage .master-storage-table td:first-child{width:32%}.master-storage-table td{overflow-wrap:anywhere}.master-storage-meta{font-size:10px}}</style>')
    helpers = r'''
const stateNames=STATE_NAMES;
const retentionUnits=RETENTION_UNITS;
function renderResourceScope(){
 const el=byId('resource-scope');if(!el)return;
 const scope=current().s.latest.resource_scope;
 el.hidden=!scope?.shared_host;
 el.textContent=scope?.shared_host?labels.sharedHostScope.replace('{count}',scope.lab_usable_gpu_count):'';
}
function namedText(item,fallback=labels.unknownValue){return item.name_missing?fallback:item.name;}
function threadPrograms(thread){return (thread.programs||[]).map((name,i)=>thread.program_names_missing?.[i]?labels.noName:name);}
function renderMasterStorage(row){
 const el=byId('storage'),st=row?.storage;el.hidden=false;
 let html='<div class="storage-head"><h2>'+esc(labels.masterStorage)+'</h2></div><p class="master-storage-meta">'+esc(labels.masterStorageScope)+'</p>';
 const stamp=instant(st?.checked_at_utc),validStamp=Number.isFinite(stamp),age=(Date.now()-stamp)/60000;
 const fresh=validStamp&&age>=-5&&age<=data.stale_after_minutes;
 html+='<p class="master-storage-meta">'+esc(labels.storageObserved)+': '+esc(time(st?.checked_at_utc))+(validStamp?' KST':'')+'</p>';
 if(!st||!['ok','partial'].includes(st.status)||st.scope!=='sg_master_mounts'){
  el.innerHTML=html+'<p class="storage-status warning-message">'+esc(labels.storageQueryFailed)+'</p>';return;
 }
 if(!fresh){el.innerHTML=html+'<p class="storage-status warning-message">'+esc(validStamp&&age>=-5?labels.storageStale:labels.storageTimeUnknown)+'</p>';return;}
 if(st.low_space_filesystems)html+='<p class="space-warning" title="'+esc(labels.storageWarning)+'">'+esc(labels.lowSpace)+' · '+st.low_space_filesystems+'</p>';
 const rows=st.volumes||[];
 for(const [scope,title] of [['shared',labels.sharedStorage],['master_local',labels.localStorage],['unclassified',labels.otherStorage]]){
  const volumes=rows.filter(v=>(['shared','master_local'].includes(v.scope)?v.scope:'unclassified')===scope);
  if(!volumes.length)continue;
  html+='<table class="master-storage-table"><caption>'+esc(title)+'</caption><thead><tr><th scope="col">'+esc(labels.mount)+'</th><th scope="col">'+esc(labels.total)+'</th><th scope="col">'+esc(labels.used)+'</th><th scope="col">'+esc(labels.available)+'</th><th scope="col" title="'+esc(labels.usagePercentNote)+'">'+esc(labels.usagePercent)+'</th></tr></thead><tbody>';
  html+=volumes.map(v=>{
   const observed=v.status==='mounted',warning=observed&&['low','full'].includes(v.space_status);
   const device=v.device==='Local filesystem'?labels.localFilesystem:volumeText(v.device);
   const mounts=v.mounts?.length?v.mounts:[device||labels.unknownValue];
   const percent=observed&&Number.isFinite(v.use_percent)&&v.use_percent>=0&&v.use_percent<=100?v.use_percent+'%':'?';
   return '<tr class="'+(warning?'low':'')+'"><td>'+mounts.map(m=>'<span class="mount-alias">'+esc(m)+'</span>').join('')+'<span class="volume-device">'+esc([v.fstype,device,v.mount_access==='read_only'?labels.readOnly:null,!observed?labels.usage_unknown:null].filter(Boolean).join(' · '))+'</span></td><td>'+capacity(observed?v.total_bytes:null)+'</td><td>'+capacity(observed?v.used_bytes:null)+'</td><td>'+capacity(observed?v.available_bytes:null)+(warning?'<span class="volume-device space-warning">'+esc(v.space_status==='full'?labels.fullSpace:labels.lowSpace)+'</span>':'')+'</td><td>'+percent+'</td></tr>';
  }).join('')+'</tbody></table>';
 }
 if(!rows.length||st.status==='partial')html+='<p class="storage-status">'+esc(labels.storagePartial)+'</p>';
 html+='<p class="master-storage-meta">'+esc(labels.storageAliasesNote)+'</p><p class="master-storage-meta">'+esc(labels.usagePercentNote)+'</p>';
 el.innerHTML=html;
}
function stateText(value){if(language==='en'||!value)return value;const names=stateNames[language];return String(value).split('+').map(part=>{const match=part.match(/^([A-Z_]+)(.*)$/);return match&&names[match[1]]?names[match[1]]+' ('+part+')':labels.unknownValue+' ('+part+')';}).join(' + ');}
function volumeText(value){return value==='Network volume'?labels.networkVolume:value==='Unknown'?labels.unknownValue:value;}
function retentionText(value){if(!value)return '?';if(language==='en')return value;return String(value).replace(/\b(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/gi,unit=>retentionUnits[language][unit.toLowerCase().replace(/s$/,'')]);}
function repaint(){
 const opened=[...document.querySelectorAll('details')].map((el,i)=>el.open?i:-1).filter(i=>i>=0);
 byId('title').textContent=labels.title;
 byId('tabs').setAttribute('aria-label',labels.host);
 byId('units-note').textContent=labels.bytesNote;
 byId('sampling-note').textContent=labels.sampleNote;
 byId('legend').innerHTML='<span><i class="swatch"></i>'+esc(labels.idle)+'</span><span><i class="swatch busy"></i>'+esc(labels.active)+'</span>';
 render();
 document.querySelectorAll('details').forEach((el,i)=>{el.open=opened.includes(i);});
}
function setLanguage(value){
 if(!['en','ko','zh','fa'].includes(value))return;
 language=value;labels=dictionaries[value];document.documentElement.lang=value==='zh'?'zh-Hans':value;document.documentElement.dir=value==='fa'?'rtl':'ltr';repaint();
}
if(typeof window!=='undefined'){
 window.addEventListener('message',event=>{
  if(event.source!==window.parent||event.data?.type!=='mtap-server-status:language')return;
  setLanguage(event.data.language);
 });
 window.parent.postMessage({type:'mtap-server-status:ready'},'*');
}
'''.replace('STATE_NAMES', json.dumps({'ko': STATES_KO, 'zh': STATES_ZH, 'fa': STATES_FA}, ensure_ascii=False)).replace('RETENTION_UNITS', json.dumps(RETENTION_UNITS, ensure_ascii=False))
    replace('render();setInterval(render,60000);', helpers + 'repaint();setInterval(repaint,60000);')
    return html
