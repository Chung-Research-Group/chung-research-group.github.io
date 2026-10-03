"""Language support for the public dashboard; no collection or publishing I/O."""
import json


KO = {
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
}
EN = {'step': 'step', 'networkVolume': 'Network volume', 'unknownValue': 'Unknown',
      'bytesNote': 'GB = 10⁹ bytes · TB = 10¹² bytes'}

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

    labels = {'en': {**localize.EN, **EN}, 'ko': {**localize.KO, **KO}}
    if labels['en'].keys() != labels['ko'].keys():
        raise ValueError('Bilingual dictionary keys differ')
    encoded = json.dumps(labels, ensure_ascii=False).replace('<', '\\u003c')
    start = html.index('const labels=')
    end = html.index(';\nconst data=', start)
    html = html[:start] + 'const dictionaries=' + encoded + ";\nlet language='en',labels=dictionaries.en" + html[end:]
    replace("new Intl.DateTimeFormat('en-GB',", "new Intl.DateTimeFormat(language==='ko'?'ko-KR':'en-GB',")
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
    replace('<span>GB = 10⁹ bytes · TB = 10¹² bytes</span>', '<span id="units-note"></span>')
    replace('<noscript>JavaScript required.</noscript>', '<noscript>JavaScript required. / JavaScript를 활성화해 주세요.</noscript>')
    # Long Korean help and scheduler explanations must wrap on narrow screens.
    replace('</style>', '.core-head{flex-wrap:wrap}.legend{white-space:normal}.node-top{flex-wrap:wrap}.node-detail,.gpu-name,.cluster-note{overflow-wrap:anywhere}.node:focus-visible{outline:3px solid var(--focus);outline-offset:2px}</style>')
    helpers = r'''
const stateNames=STATE_NAMES;
function namedText(item,fallback=labels.unknownValue){return item.name_missing?fallback:item.name;}
function threadPrograms(thread){return (thread.programs||[]).map((name,i)=>thread.program_names_missing?.[i]?labels.noName:name);}
function stateText(value){if(language!=='ko'||!value)return value;return String(value).split('+').map(part=>{const match=part.match(/^([A-Z_]+)(.*)$/);return match&&stateNames[match[1]]?stateNames[match[1]]+' ('+part+')':labels.unknownValue+' ('+part+')';}).join(' + ');}
function volumeText(value){return value==='Network volume'?labels.networkVolume:value==='Unknown'?labels.unknownValue:value;}
function retentionText(value){if(!value)return '?';if(language!=='ko')return value;return String(value).replace(/\b(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/gi,unit=>({second:'초',minute:'분',hour:'시간',day:'일',week:'주',month:'개월',year:'년'})[unit.toLowerCase().replace(/s$/,'')]);}
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
 if(!['en','ko'].includes(value))return;
 language=value;labels=dictionaries[value];document.documentElement.lang=value;repaint();
}
if(typeof window!=='undefined'){
 window.addEventListener('message',event=>{
  if(event.source!==window.parent||event.data?.type!=='mtap-server-status:language')return;
  setLanguage(event.data.language);
 });
 window.parent.postMessage({type:'mtap-server-status:ready'},'*');
}
'''.replace('STATE_NAMES', json.dumps(STATES_KO, ensure_ascii=False))
    replace('render();setInterval(render,60000);', helpers + 'repaint();setInterval(repaint,60000);')
    return html
