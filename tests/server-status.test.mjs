import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { unlistedStatusPath } from '../scripts/site-files.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=await readFile(path.join(root,unlistedStatusPath),'utf8');
const script=source.match(/<script>([\s\S]*?)<\/script>/)[1];
const token='3a15d3a8018633593678cb779c7510f56aa8ce96';
const fixture='<!doctype html><html><script id="resource-data" type="application/json">{}</script></html>';
const drain=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};

function runtime(fetcher,{savedLanguage=null,navigatorLanguage='en-US',storageBlocked=false}={}){
 const callbacks={},requests=[],intervals=[],messages=[],writes=[];
 const element=()=>({attributes:{},listeners:{},setAttribute(name,value){this.attributes[name]=value;},addEventListener(event,fn){this.listeners[event]=fn;}});
 const frame={...element(),hidden:true,srcdoc:'',style:{},contentWindow:{postMessage:(message,origin)=>messages.push({message,origin})}};
 const status={textContent:'',dataset:{}};
 const button={disabled:false,addEventListener:(event,fn)=>{callbacks[event]=fn;}};
 const listeners={},description={},languageGroup=element(),languageButtons={ko:element(),en:element(),zh:element(),fa:element()};
 const document={documentElement:{},title:'',querySelector:()=>description,getElementById:id=>({'dashboard':frame,'load-status':status,'refresh':button,'languages':languageGroup,'language-ko':languageButtons.ko,'language-en':languageButtons.en,'language-zh':languageButtons.zh,'language-fa':languageButtons.fa})[id]};
 const context={document,navigator:{language:navigatorLanguage,languages:[navigatorLanguage]},
  localStorage:{getItem:key=>{assert.equal(key,'mtap-server-status:language');if(storageBlocked)throw new Error('storage_blocked');return savedLanguage;},setItem:(key,value)=>{if(storageBlocked)throw new Error('storage_blocked');writes.push({key,value});}},
  window:{addEventListener:(event,fn)=>{listeners[event]=fn;}},AbortController,Date,Number,Math,
  fetch:async(url,options)=>{requests.push({url,options});return fetcher(url,options);},
  setTimeout:()=>1,clearTimeout:()=>{},setInterval:(fn,ms)=>{intervals.push({fn,ms});return 1;}};
 vm.runInNewContext(script,context,{timeout:1000});
 return {frame,status,button,callbacks,listeners,requests,intervals,messages,writes,document,description,languageGroup,languageButtons};
}

test('status route remains standalone, noindex and isolated',async()=>{
 assert.match(source,/<meta name="robots" content="noindex,nofollow,noarchive">/);
 assert.match(source,/<iframe[^>]*sandbox="allow-scripts"/);
 assert.doesNotMatch(source,/allow-same-origin|<nav\b|<a\b/);
 for(const file of ['index.html','scripts/site-chrome.mjs']){
  assert.equal((await readFile(path.join(root,file),'utf8')).includes(token),false);
 }
 const manifest=JSON.parse(await readFile(path.join(root,'dist/site-manifest.json'),'utf8'));
 assert.equal(unlistedStatusPath in manifest.files,false);
 assert.equal(await readFile(path.join(root,'dist',unlistedStatusPath),'utf8'),source);
});

test('successful fetch uses only the fixed data branch and preserves iframe sandbox',async()=>{
 const r=runtime(async()=>({ok:true,text:async()=>fixture}));await drain();
 assert.equal(r.requests.length,1);
 assert.ok(r.requests[0].url.startsWith('https://raw.githubusercontent.com/Chung-Research-Group/chung-research-group.github.io/server-status-data/status/'+token+'.html?t='));
 assert.equal(r.requests[0].options.credentials,'omit');
 assert.equal(r.requests[0].options.cache,'no-store');
 assert.equal(r.frame.srcdoc,fixture);assert.equal(r.frame.hidden,false);
 assert.equal(r.status.dataset.warning,'false');assert.equal(r.intervals[0].ms,300000);
});

test('refresh failure retains last document and marks the loader unavailable',async()=>{
 let attempt=0;
 const r=runtime(async()=>{if(attempt++)throw new Error('fixture_failure');return {ok:true,text:async()=>fixture};});
 await drain();await r.callbacks.click();
 assert.equal(r.frame.srcdoc,fixture);assert.equal(r.frame.hidden,false);
 assert.equal(r.status.dataset.warning,'true');assert.match(r.status.textContent,/Refresh unavailable/);
 assert.equal(r.button.disabled,false);
});

test('invalid response is not inserted into the frame',async()=>{
 const r=runtime(async()=>({ok:true,text:async()=>'<html>unexpected response</html>'}));await drain();
 assert.equal(r.frame.srcdoc,'');assert.equal(r.frame.hidden,true);
 assert.equal(r.status.dataset.warning,'true');
});

test('height messages require the exact child window and a bounded numeric value',async()=>{
 const r=runtime(async()=>({ok:true,text:async()=>fixture}));await drain();
 r.listeners.message({source:{},data:{type:'mtap-server-status:size',height:900}});
 assert.equal(r.frame.style.height,undefined);
 for(const height of ['900',Infinity,-1,50000])r.listeners.message({source:r.frame.contentWindow,data:{type:'mtap-server-status:size',height}});
 assert.equal(r.frame.style.height,undefined);
 r.listeners.message({source:r.frame.contentWindow,data:{type:'mtap-server-status:size',height:900.2}});
 assert.equal(r.frame.style.height,'901px');
});

test('saved language wins over browser language and invalid preferences fall back safely',async()=>{
 for(const [savedLanguage,navigatorLanguage,expected] of [['en','ko-KR','en'],['ko','en-US','ko'],[null,'ko-KR','ko'],['invalid','en-US','en'],['invalid','ko-KR','ko'],[null,'ja-JP','en']]){
  const r=runtime(async()=>({ok:true,text:async()=>fixture}),{savedLanguage,navigatorLanguage});await drain();
  assert.equal(r.document.documentElement.lang,expected);
  assert.equal(r.languageButtons[expected].attributes['aria-pressed'],'true');
 }
});

test('language switch persists preference and translates labels without replacing the dashboard',async()=>{
 const r=runtime(async()=>({ok:true,text:async()=>fixture}));await drain();
 const loadedDocument=r.frame.srcdoc;
 r.languageButtons.ko.listeners.click();
 assert.equal(r.document.documentElement.lang,'ko');assert.equal(r.document.title,'서버 상태 — Chung Research Group');
 assert.equal(r.button.textContent,'새로고침');assert.equal(r.status.textContent,'서버 상태는 매시간 수집됩니다.');
 assert.equal(r.frame.title,'연구실 서버 상태');assert.equal(r.description.content,'매시간 수집하는 연구실 컴퓨팅 자원 현황입니다.');
 assert.equal(r.languageGroup.attributes['aria-label'],'표시 언어');
 assert.equal(r.languageButtons.ko.attributes['aria-label'],'한국어로 보기');assert.equal(r.languageButtons.en.attributes['aria-label'],'영어로 보기');
 assert.equal(r.languageButtons.ko.attributes['aria-pressed'],'true');assert.equal(r.languageButtons.en.attributes['aria-pressed'],'false');
 assert.deepEqual(r.writes,[{key:'mtap-server-status:language',value:'ko'}]);
 assert.equal(r.messages.at(-1).message.type,'mtap-server-status:language');assert.equal(r.messages.at(-1).message.language,'ko');
 assert.equal(r.frame.srcdoc,loadedDocument);assert.equal(r.requests.length,1);
 r.languageButtons.en.listeners.click();assert.equal(r.document.documentElement.lang,'en');
 assert.equal(r.document.title,'Server status — Chung Research Group');assert.equal(r.button.textContent,'Refresh');
 assert.equal(r.status.textContent,'Server observations refresh hourly.');assert.equal(r.languageGroup.attributes['aria-label'],'Display language');
 assert.equal(r.frame.srcdoc,loadedDocument);assert.equal(r.writes.at(-1).value,'en');
});

test('blocked local storage still allows browser default and language switching',async()=>{
 const r=runtime(async()=>({ok:true,text:async()=>fixture}),{navigatorLanguage:'ko-KR',storageBlocked:true});await drain();
 assert.equal(r.document.documentElement.lang,'ko');r.languageButtons.en.listeners.click();
 assert.equal(r.document.documentElement.lang,'en');assert.equal(r.frame.srcdoc,fixture);
 assert.equal(r.writes.length,0);assert.equal(r.messages.at(-1).message.language,'en');
});

test('loading and unavailable states use the active language',async()=>{
 const loading=runtime(()=>new Promise(()=>{}),{savedLanguage:'ko'});
 assert.equal(loading.status.textContent,'서버 상태를 불러오는 중…');
 loading.languageButtons.en.listeners.click();assert.equal(loading.status.textContent,'Loading server status…');
 const failed=runtime(async()=>{throw new Error('fixture_failure');},{savedLanguage:'ko'});await drain();
 assert.equal(failed.status.textContent,'일시적으로 서버 상태를 불러올 수 없습니다. 자동으로 다시 시도합니다.');
 failed.languageButtons.en.listeners.click();assert.equal(failed.status.textContent,'Server status is temporarily unavailable. Retrying automatically.');
 let attempt=0;
 const cached=runtime(async()=>{if(attempt++)throw new Error('fixture_failure');return {ok:true,text:async()=>fixture};},{savedLanguage:'ko'});
 await drain();await cached.callbacks.click();
 assert.equal(cached.status.textContent,'새로고침할 수 없습니다. 마지막으로 불러온 서버 상태를 표시합니다.');
 cached.languageButtons.en.listeners.click();assert.equal(cached.status.textContent,'Refresh unavailable. The last loaded dashboard is shown below.');
 assert.equal(cached.frame.srcdoc,fixture);
});

test('frame load and trusted ready messages restore the currently selected language',async()=>{
 const r=runtime(async()=>({ok:true,text:async()=>fixture}),{savedLanguage:'ko'});await drain();
 r.listeners.message({source:{},data:{type:'mtap-server-status:ready'}});assert.equal(r.messages.length,0);
 r.listeners.message({source:r.frame.contentWindow,data:{type:'mtap-server-status:ready'}});
 assert.equal(r.messages.length,1);assert.equal(r.messages[0].message.language,'ko');assert.equal(r.messages[0].origin,'*');
 r.languageButtons.en.listeners.click();r.frame.listeners.load();
 assert.equal(r.messages.at(-1).message.language,'en');
 await r.intervals[0].fn();r.frame.listeners.load();assert.equal(r.messages.at(-1).message.language,'en');
 assert.equal(r.document.documentElement.lang,'en');
});

test('Chinese and Farsi preferences, browser defaults and directions work',async()=>{
 for(const [savedLanguage,navigatorLanguage,expected] of [
  [null,'zh-CN','zh'],[null,'fa-IR','fa'],['fa','en-US','fa'],['zh','ko-KR','zh'],['invalid','fa-IR','fa']
 ]){
  const r=runtime(async()=>({ok:true,text:async()=>fixture}),{savedLanguage,navigatorLanguage});await drain();
  assert.equal(r.document.documentElement.lang,expected==='zh'?'zh-Hans':expected);
  assert.equal(r.document.documentElement.dir,expected==='fa'?'rtl':'ltr');
  assert.equal(r.languageButtons[expected].attributes['aria-pressed'],'true');
  assert.equal(r.requests.length,1);
 }
});

test('new language switches preserve the loaded document and restore LTR',async()=>{
 const r=runtime(async()=>({ok:true,text:async()=>fixture}));await drain();
 for(const [code,refresh,lang,dir] of [
  ['zh','刷新','zh-Hans','ltr'],['fa','تازه‌سازی','fa','rtl'],['en','Refresh','en','ltr'],['ko','새로고침','ko','ltr']
 ]){
  r.languageButtons[code].listeners.click();
  assert.equal(r.button.textContent,refresh);
  assert.equal(r.document.documentElement.lang,lang);
  assert.equal(r.document.documentElement.dir,dir);
  assert.equal(r.frame.srcdoc,fixture);
  assert.equal(r.requests.length,1);
  assert.equal(r.writes.at(-1).value,code);
  assert.equal(r.messages.at(-1).message.language,code);
 }
});

test('new language loading and failed refresh messages are translated',async()=>{
 for(const [code,loadingText,failedText] of [
  ['zh','正在加载服务器状态…','服务器状态暂时不可用，正在自动重试。'],
  ['fa','در حال بارگذاری وضعیت سرور…','وضعیت سرور موقتاً در دسترس نیست. تلاش مجدد خودکار انجام می‌شود.']
 ]){
  const loading=runtime(()=>new Promise(()=>{}),{savedLanguage:code});
  assert.equal(loading.status.textContent,loadingText);
  const failed=runtime(async()=>{throw new Error('fixture');},{savedLanguage:code});await drain();
  assert.equal(failed.status.textContent,failedText);
  assert.equal(failed.frame.hidden,true);
 }
});
