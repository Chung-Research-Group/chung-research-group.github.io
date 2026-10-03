// Offline DOM-state tests for the actual generated detailed HTML renderer.
// No browser/network access. Never print the embedded observations.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const artifact = process.argv[2] || path.join(__dirname, 'detailed-server-status-en.html');
const html = fs.readFileSync(artifact, 'utf8');
const jsonMatch = html.match(/<script id="resource-data" type="application\/json">([\s\S]*?)<\/script>/);
assert.ok(jsonMatch, 'approved embedded payload must exist');
const original = JSON.parse(jsonMatch[1]);
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const source = scripts.at(-1);
assert.ok(source && source.includes('render'), 'actual renderer script must exist');
const baseNow = Date.parse('2026-10-03T13:00:00Z');
const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const data = clone(original);
  for (const entry of data.servers) {
    const row = entry.latest;
    row.status = 'ok';
    row.local_completed_at_utc = new Date(baseNow - 5 * 60000).toISOString();
    if (row.kind === 'slurm_cluster') {
      row.query_ok = {...row.query_ok, nodes: true, queue: true};
    } else {
      row.memory_total_gib = 64;
      row.memory_available_gib = 12.345;
    }
    entry.last_good = clone(row);
  }
  return data;
}

function harness(data, initialHost = 'carbon') {
  data = clone(data);
  data.host = initialHost;
  let currentTime = baseNow;
  const timers = [];
  class Element {
    constructor(id) {
      this.id = id; this.innerHTML = ''; this.textContent = ''; this.hidden = false;
      this.className = ''; this.attributes = {}; this.listeners = {};
      this.parentElement = {hidden: false};
    }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key]; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    insertAdjacentHTML(_position, value) { this.innerHTML += value; }
    replaceChildren() { this.innerHTML = ''; this.textContent = ''; }
    focus() {}
  }
  const elements = new Map();
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[1]);
    element.hidden = /\bhidden(?:\s|>|=)/.test(match[0]);
    elements.set(match[1], element);
  }
  function get(id) {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  }
  get('resource-data').textContent = JSON.stringify(data);
  const document = {getElementById: get, querySelectorAll: () => [],
    documentElement: {lang: 'en'}, title: ''};
  const RealDate = Date;
  class ClockDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [currentTime])); }
    static now() { return currentTime; }
  }
  const context = vm.createContext({document, Date: ClockDate, Intl, Map, Set,
    setInterval(callback) { timers.push(callback); return timers.length; }});
  vm.runInContext(source, context, {timeout: 2000});
  return {get, context, data,
    switchHost(host) { vm.runInContext('activeHost=' + JSON.stringify(host) + ';render();', context, {timeout: 2000}); },
    tick(minutes) { currentTime += minutes * 60000; timers.forEach(callback => callback()); },
    selectNode() { vm.runInContext('if(nodeMap.size)nodeDetails([...nodeMap.keys()][0]);', context, {timeout: 2000}); }};
}

function unknownDisplay(h, message) {
  assert.ok(/unknown|observation|unavailable|failed|stale/i.test(h.get('status').textContent + h.get('metrics').innerHTML), message);
  assert.ok(!h.get('metrics').innerHTML.includes('13.3'), message + ': stale free RAM hidden');
  assert.equal(h.get('gpus').innerHTML, '', message + ': GPU cards cleared');
  assert.equal(h.get('sockets').innerHTML, '', message + ': core/node grid cleared');
  assert.equal(h.get('selection').innerHTML, '', message + ': selected detail cleared');
  assert.ok(h.get('cluster-jobs').hidden, message + ': current jobs hidden');
  assert.ok(h.get('cluster-usage').hidden, message + ': current ranking hidden');
}

let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

test('all three fresh tabs render using the actual detailed script', () => {
  const h = harness(fixture());
  assert.ok(h.get('metrics').innerHTML.includes('13.3'), 'fresh RAM must render');
  for (const host of ['sg', 'carbon', 'oxygen']) {
    h.switchHost(host);
    assert.ok(h.get('tabs').innerHTML.includes('aria-selected="true"'), 'selected tab must render');
    assert.ok(h.get('metrics').innerHTML.length > 0, 'host metrics must render');
  }
  h.switchHost('sg'); h.selectNode();
  assert.ok(h.get('sockets').innerHTML.length > 0, 'fresh nodes must render');
});

test('ninety-minute expiry repaints the full panel on the timer', () => {
  const h = harness(fixture());
  h.tick(86);
  unknownDisplay(h, 'timer expiry');
  h.switchHost('sg'); unknownDisplay(h, 'expired SG after tab switch');
});

test('initially stale observations never show old resource values', () => {
  const data = fixture();
  data.servers.forEach(s => s.latest.local_completed_at_utc = new Date(baseNow - 91 * 60000).toISOString());
  const h = harness(data);
  unknownDisplay(h, 'initial stale');
});

test('failed collection does not silently render last-good measurements', () => {
  const data = fixture();
  data.servers.forEach(s => s.latest.status = 'unreachable');
  const h = harness(data);
  unknownDisplay(h, 'collection failed');
  h.switchHost('sg'); unknownDisplay(h, 'SG collection failed');
});

test('invalid missing and future timestamps do not throw or appear current', () => {
  for (const stamp of ['bad-date', null, '2026-10-03T15:00:00Z']) {
    const data = fixture();
    data.servers.forEach(s => s.latest.local_completed_at_utc = stamp);
    const h = harness(data);
    unknownDisplay(h, 'invalid timestamp');
    assert.ok(!h.get('status').textContent.includes('1970'), 'unknown time must not become epoch time');
  }
});

test('GPU query failure preserves independently valid CPU and RAM', () => {
  const data = fixture();
  const row = data.servers.find(s => s.host === 'carbon').latest;
  row.gpu_query_ok = false;
  if (row.occupancy?.gpu) row.occupancy.gpu.known = false;
  const h = harness(data);
  assert.ok(h.get('metrics').innerHTML.includes('13.3'), 'valid RAM retained');
  assert.ok(/failed|unknown/i.test(h.get('gpus').innerHTML), 'GPU failure shown');
});

test('partial queue failure preserves valid node query and hides jobs', () => {
  const data = fixture();
  const row = data.servers.find(s => s.host === 'sg').latest;
  row.query_ok.queue = false; row.jobs = []; row.job_states = {}; row.visible_job_count = null;
  const h = harness(data, 'sg');
  assert.ok(/job.*unavailable|job.*failed|query.*failed/i.test(h.get('status').textContent), 'queue failure shown');
  assert.ok(h.get('sockets').innerHTML.length > 0, 'valid node observations retained');
});

test('Korean and English repaint every server while preserving observations', () => {
  const h = harness(fixture());
  for (const host of ['sg', 'carbon', 'oxygen']) {
    h.switchHost(host);
    const before = vm.runInContext('JSON.stringify(data)', h.context);
    vm.runInContext("setLanguage('ko')", h.context);
    assert.equal(h.get('title').textContent, '서버 자원 현황');
    assert.equal(h.get('tabs').getAttribute('aria-label'), '서버');
    assert.ok(h.get('metrics').innerHTML.includes(host === 'sg' ? '할당된 Slurm CPU' : '관측된 사용 중 코어'));
    assert.equal(vm.runInContext('activeHost', h.context), host);
    assert.equal(vm.runInContext('JSON.stringify(data)', h.context), before);
    vm.runInContext("setLanguage('en')", h.context);
    assert.equal(h.get('title').textContent, 'Compute resources');
  }
});

test('Korean stale and missing-time states remain unknown', () => {
  const h = harness(fixture());
  vm.runInContext("setLanguage('ko')", h.context);
  h.tick(86);
  assert.match(h.get('status').textContent, /유효 시간 초과/);
  assert.match(h.get('metrics').innerHTML, /현재 상태를 확인할 수 없습니다/);
  assert.equal(h.get('sockets').innerHTML, '');
  assert.equal(vm.runInContext("time('invalid')", h.context), '미확인');
});

test('localized scheduler states retain codes and reject invalid languages', () => {
  const h = harness(fixture());
  vm.runInContext("setLanguage('ko')", h.context);
  assert.equal(vm.runInContext("stateText('MIXED+DRAIN')", h.context), '일부 할당 (MIXED) + 할당 중지 (DRAIN)');
  assert.equal(vm.runInContext("retentionText('12 months')", h.context), '12 개월');
  vm.runInContext("setLanguage('invalid')", h.context);
  assert.equal(h.get('title').textContent, '서버 자원 현황');
});

test('missing placeholders translate without changing real Unknown identifiers', () => {
  const h = harness(fixture());
  vm.runInContext("setLanguage('ko')", h.context);
  assert.equal(vm.runInContext("namedText({name:'Unknown',name_missing:true})", h.context), '미확인');
  assert.equal(vm.runInContext("namedText({name:'Unknown',name_missing:false})", h.context), 'Unknown');
  assert.equal(vm.runInContext("threadPrograms({programs:['Unknown','Unknown'],program_names_missing:[true,false]}).join('|')", h.context), '프로그램 정보 없음|Unknown');
});

console.log('Detailed renderer DOM-state checks passed: ' + passed);
