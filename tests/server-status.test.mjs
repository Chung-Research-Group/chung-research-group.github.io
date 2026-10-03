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

function runtime(fetcher){
 const callbacks={},requests=[],intervals=[];
 const frame={hidden:true,srcdoc:'',style:{},contentWindow:{}};
 const status={textContent:'',dataset:{}};
 const button={disabled:false,addEventListener:(event,fn)=>{callbacks[event]=fn;}};
 const listeners={};
 const context={document:{getElementById:id=>({'dashboard':frame,'load-status':status,'refresh':button})[id]},
  window:{addEventListener:(event,fn)=>{listeners[event]=fn;}},AbortController,Date,Number,Math,
  fetch:async(url,options)=>{requests.push({url,options});return fetcher(url,options);},
  setTimeout:()=>1,clearTimeout:()=>{},setInterval:(fn,ms)=>{intervals.push({fn,ms});return 1;}};
 vm.runInNewContext(script,context,{timeout:1000});
 return {frame,status,button,callbacks,listeners,requests,intervals};
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
