"""Inject one complete language dictionary into the common dashboard template."""
import json

EN = {'title':'Compute resources','host':'Host','cpu':'Observed active cores','ram':'Available RAM',
      'of':'of','vram':'Free VRAM','cores':'CPU cores','physical':'cores','threads':'threads',
      'socket':'Socket','core':'Core','smt':'SMT thread detail','idle':'Idle','active':'Active',
      'ok':'Updated','failed':'Query failed; current status unknown','lastGood':'Last successful sample:',
      'unknown':'No current observation','stale':'Stale; current status unknown',
      'gpuFailed':'GPU query failed','noName':'Program not sampled','noCores':'No per-core sample',
      'sampleNote':'Program labels are sampled; threads migrate.'}
KO = {'title':'컴퓨터 자원','host':'서버','cpu':'관측 사용 코어','ram':'사용 가능 RAM',
      'of':'전체','vram':'여유 VRAM','cores':'CPU 코어','physical':'코어','threads':'스레드',
      'socket':'소켓','core':'코어','smt':'SMT 스레드 상세','idle':'유휴','active':'사용 중',
      'ok':'갱신됨','failed':'조회 실패 · 현재 상태 미확인','lastGood':'마지막 정상 관측:',
      'unknown':'현재 관측 없음','stale':'오래된 관측 · 현재 상태 미확인',
      'gpuFailed':'GPU 조회 실패','noName':'프로그램 미관측','noCores':'코어별 표본 없음',
      'sampleNote':'프로그램은 표본입니다. 스레드는 코어 사이를 이동합니다.'}

EN.update({'jobCounter':'Latest observed job ID','jobCounterNote':'Latest visible submission in 7-day all-user accounting; not a lifetime count.','jobIdLimit':'ID wrap limit','cumulativeReview':'Separate cumulative milestone counter under review; celebrations not active.'})
KO.update({'jobCounter':'최근 관측 job ID','jobCounterNote':'최근 7일 전체 사용자 accounting에서 확인한 제출 번호입니다. 전체 누적 건수가 아닙니다.','jobIdLimit':'ID 순환 상한','cumulativeReview':'별도 누적 milestone 카운터 검토 중 · 축하 알림 미활성.'})


EN.update({'gpuCount':'GPUs in compute use','gpu_compute':'Compute','gpu_graphics':'Graphics only',
           'gpu_idle':'No compute process','gpu_unknown':'Unknown','details':'Details','utilization':'Utilization',
           'cpuCriterion':'Physical core counted once when either SMT thread has >=1% active CPU time in the sample. Observed activity, not scheduler allocation. Missing counters/topology: unknown.',
           'gpuCriterion':'Devices with observed non-desktop compute or MPS contexts. Graphics-only sessions are excluded. Not scheduler reservations; incomplete observations are unknown.'})
KO.update({'gpuCount':'계산 사용 GPU','gpu_compute':'계산 사용','gpu_graphics':'그래픽만 사용',
           'gpu_idle':'계산 프로세스 없음','gpu_unknown':'미확인','details':'상세','utilization':'사용률',
           'cpuCriterion':'표본에서 SMT 스레드 하나라도 활성 시간이 1% 이상이면 물리 코어를 한 번 셉니다. 관측 활동이며 스케줄러 할당량은 아닙니다. 카운터·토폴로지 누락은 미확인입니다.',
           'gpuCriterion':'관측된 계산 또는 MPS 컨텍스트가 있는 GPU 수입니다. 데스크톱·그래픽만 사용하면 제외합니다. 예약량이 아니며 불완전한 관측은 미확인입니다.'})

EN.update({'storage':'Storage','disks':'Physical drives','mount':'Filesystem / partition','total':'Total','used':'Used','available':'User available','unmounted':'Unmounted','container':'Container','swap':'Swap','usage_unknown':'Usage unavailable','storageUnknown':'Storage unavailable','storagePartial':'Some capacity counters unavailable','lowSpace':'Low space','fullSpace':'No user space','blockSize':'partition size','storageWarning':'User available below 10%, or below 20 GB on filesystems of at least 20 GB; filesystem capacity excludes reserved blocks.'})
KO.update({'storage':'저장 공간','disks':'물리 디스크','mount':'파일시스템 / 파티션','total':'전체','used':'사용','available':'사용자 가용','unmounted':'마운트 안 됨','container':'컨테이너','swap':'스왑','usage_unknown':'사용량 확인 불가','storageUnknown':'저장 공간 확인 불가','storagePartial':'일부 용량 확인 불가','lowSpace':'공간 부족','fullSpace':'사용자 공간 없음','blockSize':'파티션 크기','storageWarning':'사용자 가용 공간 10% 미만 또는 20 GB 이상 파일시스템에서 20 GB 미만; 파일시스템 가용량은 예약 공간을 제외합니다.'})


EN.update({'readOnly':'Read-only','allocatedCpu':'Allocated Slurm CPUs','computeNodes':'Compute nodes','nodesAllocated':'with allocations','configuredRam':'Configured RAM','notSampled':'Not sampled','allocatedGpu':'Allocated GPUs','allocationNote':'Scheduler allocation; measured CPU utilization is unavailable.','clusterNote':'Slurm allocations and job labels; no per-core samples.','gpuClusterNote':'Configured Slurm GPUs; allocation, utilization and VRAM samples are unavailable when shown as ?.','topology':'Configured topology','threadsPerCore':'threads/core','allocatedRam':'Allocated RAM (Slurm)','osFree':'OS FreeMem (Slurm)','notAvailable':'not MemAvailable','jobLabels':'Job labels','noAssignedJobs':'No visible assigned job','visibleJobs':'Visible jobs','jobLabelsNote':'Scheduler job names, not sampled executable names. Pending jobs have no assigned node.','jobsLimit':'First 30 shown; totals include all visible records.','state':'State','nodes':'Nodes','queueFailed':'Node query updated; job query unavailable'})
KO.update({'readOnly':'읽기 전용','allocatedCpu':'할당된 Slurm CPU','computeNodes':'계산 노드','nodesAllocated':'할당된 노드','configuredRam':'설정된 RAM','notSampled':'실측 표본 없음','allocatedGpu':'할당된 GPU','allocationNote':'스케줄러 할당량입니다. 실측 CPU 이용률은 조회되지 않았습니다.','clusterNote':'Slurm 할당량과 작업 이름입니다. 코어별 실측 표본은 없습니다.','gpuClusterNote':'Slurm에 설정된 GPU입니다. ?는 할당량·이용률·VRAM 표본을 알 수 없음을 뜻합니다.','topology':'설정된 토폴로지','threadsPerCore':'스레드/코어','allocatedRam':'할당된 RAM (Slurm)','osFree':'OS FreeMem (Slurm)','notAvailable':'MemAvailable이 아님','jobLabels':'작업 이름','noAssignedJobs':'표시 가능한 할당 작업 없음','visibleJobs':'조회된 작업','jobLabelsNote':'스케줄러 작업 이름이며 실측 실행 파일 이름은 아닙니다. 대기 작업에는 할당된 노드가 없습니다.','jobsLimit':'처음 30개 표시; 합계에는 조회된 모든 작업을 포함합니다.','state':'상태','nodes':'노드','queueFailed':'노드 조회 성공; 작업 조회 실패'})


EN.update({'fp32':'Nominal FP32','combined':'Combined','fp32Note':'Base-clock CPU SIMD and ordinary GPU arithmetic reference estimates.','fp32Formula':'CPU TFLOPS = physical cores × base GHz × SIMD lanes × 2 FLOPs/FMA × model-specific FMA units ÷ 1000.'})
KO.update({'fp32':'공칭 이론 FP32','combined':'합계','fp32Note':'기본클럭 CPU SIMD와 GPU 일반 연산 기준의 이론 추정값입니다.','fp32Formula':'CPU TFLOPS = 물리 코어 × 기본 GHz × SIMD 레인 × FMA당 2 FLOP × 모델별 FMA 유닛 수 ÷ 1000.'})


EN.update({'fp64':'Nominal FP64','precisionNote':'Specification-based theoretical rates: CPU base-clock SIMD and ordinary GPU arithmetic. FP64 is relevant to periodic DFT; FP32 to MLIP workloads.','precisionFormula':'CPU TFLOPS = physical cores × base GHz × SIMD lanes × 2 FLOPs/FMA × model-specific FMA units / 1000. Silver 4116: 512-bit ×1; EPYC 7002: 256-bit ×2; Gold 6430: 512-bit ×2. CPU and GPU rates are separate.'})
KO.update({'fp64':'공칭 이론 FP64','precisionNote':'사양 기준 이론 성능: CPU 기본클럭 SIMD와 GPU 일반 연산입니다. 주기계 DFT는 FP64, MLIP는 FP32를 주요 지표로 봅니다.','precisionFormula':'CPU TFLOPS = 물리 코어 × 기본 GHz × SIMD 레인 × FMA당 2 FLOP × 모델별 FMA 유닛 수 / 1000. Silver 4116: 512비트 ×1; EPYC 7002: 256비트 ×2; Gold 6430: 512비트 ×2. CPU·GPU 값은 별도로 표시합니다.'})

EN.update({'runningJobs':'Running jobs','pendingJobs':'Pending jobs','masterScope':'Cluster-wide compute-node status queried via SG-Master; the master/login host is excluded.'})
KO.update({'runningJobs':'실행 중 작업','pendingJobs':'대기 작업','masterScope':'SG-Master에서 조회한 계산 클러스터 전체 상태입니다. 마스터·로그인 호스트는 제외합니다.'})

EN.update({'usageTitle':'Started-job counts','usageMetric':'Unique allocations that actually started; job counts, not CPU-hours. Each array task counts once; steps, batch/extern and requeues do not add jobs. Month = earliest retained actual start (KST).',
 'retainedPeriod':'Currently queryable retained records','notLifetime':'Partial accounting history; earlier purged/archived records were not retrieved. No month is certified complete.',
 'retention':'Configured retention (from job end)','allUsers':'All-user access verified: --allusers and controller/database PrivateData=none.',
 'scopeUnverified':'All-user access could not be verified; only visible records are represented.',
 'approvalPending':'Names and rankings withheld pending approval of the page audience.',
 'currentLeader':'Most running now','projectAccount':'Project Account','slurmUser':'User','unassigned':'Unassigned / missing',
 'allTop5':'Top 5 · retained period','monthTop3':'Monthly Top 3 · retained records','partialMonth':'boundary month / incomplete',
 'countJobs':'jobs','noNamedAccounts':'No named project Account available','usageUnavailable':'Accounting query unavailable; history unknown.',
 'audit':'Validation','requeuesRemoved':'requeue records collapsed','noStartRemoved':'no actual start excluded',
 'ambiguity':'Same-ID ambiguity: conservative lower count; upper bound','purgeCaveat':'Earliest retained start may follow a purged first attempt. Requeue links use same task/user and preceding NODE_FAIL, PREEMPTED or REQUEUED; same-owner ID reuse needs lineage validation.',
 'localReview':'LOCAL REVIEW — identities are not published; page-audience approval is pending.',
 'lineageBounds':'Retained-record count bounds if inferred requeue links were ID reuse instead'})
KO.update({'usageTitle':'실제 시작 작업 집계','usageMetric':'실제로 시작한 고유 allocation 건수이며 CPU 사용시간 순위는 아닙니다. 배열 요소는 각각 한 번, step·batch/extern·재실행은 추가 집계하지 않습니다. 월은 최초로 보존된 실제 시작시각의 KST 기준입니다.',
 'retainedPeriod':'현재 조회 가능한 보존 기록','notLifetime':'일부 accounting 기록입니다. 이전에 삭제·보관된 기록은 조회하지 않았으며 어느 월도 완전한 기록으로 보증하지 않습니다.',
 'retention':'설정된 보존 기간 (작업 종료 기준)','allUsers':'전체 사용자 조회 검증: --allusers, controller/database PrivateData=none.',
 'scopeUnverified':'전체 사용자 조회 미검증; 현재 조회되는 기록만 집계합니다.',
 'approvalPending':'페이지 공개 범위 승인 전까지 계정명과 순위는 게시하지 않습니다.',
 'currentLeader':'현재 실행 중 최다','projectAccount':'프로젝트 Account','slurmUser':'사용자 User','unassigned':'미지정 / 누락',
 'allTop5':'Top 5 · 보존된 조회 기간','monthTop3':'월별 Top 3 · 보존 기록','partialMonth':'경계 월 / 불완전',
 'countJobs':'건','noNamedAccounts':'조회 가능한 프로젝트 Account 이름 없음','usageUnavailable':'Accounting 조회 실패; 과거 기록 미확인.',
 'audit':'검증','requeuesRemoved':'재실행 중복 제거','noStartRemoved':'실제 시작 없음 제외',
 'ambiguity':'동일 ID 구분 불확실: 보수적 하한 집계; 상한','purgeCaveat':'최초 시도가 삭제됐다면 보존된 시작시각은 원래 최초 시작과 다릅니다. 같은 작업·사용자의 선행 NODE_FAIL·PREEMPTED·REQUEUED를 재실행 연결 근거로 사용합니다. 같은 사용자에게 재사용된 ID는 이력 검증이 필요합니다.',
 'localReview':'로컬 검토본 — 계정명은 게시되지 않았으며 공개 범위 승인 대기 중입니다.',
 'lineageBounds':'추정 재실행 연결이 ID 재사용이었다면 가능한 보존 기록 건수 범위'})

EN.update({'allTop5':'Top 5 · historical','lastMonthTop3':'Last month Top 3','rankingJobs':'Started jobs',
           'rankingScope':'User ranking · retained records only, not lifetime history.',
           'methodDetails':'Method and coverage','rankNumber':'Rank','noRetainedStarts':'No retained started-job records'})
KO.update({'allTop5':'Top 5 · 누적','lastMonthTop3':'지난달 Top 3','rankingJobs':'시작 작업 수',
           'rankingScope':'User 기준 · 보존된 조회 기록이며 역사 전체가 아닙니다.',
           'methodDetails':'집계 기준·조회 범위','rankNumber':'순위','noRetainedStarts':'보존된 시작 작업 기록 없음'})

EN["memoryTrackingOff"] = 'Slurm memory reservations are not tracked in the current configuration. A reported zero is not measured memory usage or OS-available RAM.'
KO["memoryTrackingOff"] = '현재 Slurm 설정은 메모리 예약량을 추적하지 않습니다. 보고값 0은 실제 사용량이나 OS 가용 RAM을 뜻하지 않습니다.'

def localized_template(template, language):
    labels = EN if language == 'en' else KO
    return template.replace('RESOURCE_LANGUAGE', language).replace(
        'RESOURCE_LABELS', json.dumps(labels, ensure_ascii=False).replace('<', '\\u003c'))


def english_template(template):
    return localized_template(template, 'en')


def korean_template(template):
    return localized_template(template, 'ko')
