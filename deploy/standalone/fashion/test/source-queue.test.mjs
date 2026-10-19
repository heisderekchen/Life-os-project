import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceQueue} from '../source-queue.mjs';
import {sourceSearchPlan} from '../source-planner.mjs';
import {createSourceStore} from '../admin/store.mjs';
const batches=()=>Array.from({length:200},(_,i)=>({label:'sources',domains:Array.from({length:5},(_,j)=>`source${i*5+j}.test`)}));

test('real 1000-source catalogue is entirely planned in broad mode, with Nike ranked first',async()=>{
 const store=createSourceStore({registryFile:new URL('../data/source-registry.json',import.meta.url),settingsFile:'/tmp/fashion-nonexistent-queue-settings.json'});
 const data=await store.read();const input={subject:'nike',sourceScope:2,sources:['official','media','retail'],domains:[]};
 const plans=sourceSearchPlan(input,data.sources);
 assert.equal(new Set(plans.flatMap(p=>p.domains)).size,1000);assert(plans[0].domains.includes('nike.com'));assert(plans[0].catalogue==='nike');assert(plans.every(p=>p.domains.length<=5));
 const focused=sourceSearchPlan({...input,sourceScope:0},data.sources);assert(focused.flatMap(p=>p.domains).length<30);
});
test('1000 sources in 200 batches finish with immutable, separated counters',async()=>{
 const updates=[];let sources=0;const end=await runSourceQueue({entries:batches(),concurrency:3,onUpdate:s=>updates.push(s),runEntry:async e=>{sources+=e.domains.length;return{items:e.domains.map(d=>({source:d}))};}});
 assert.equal(sources,1000);assert.equal(end.plannedSources,1000);assert.equal(end.queriedSources,1000);assert.equal(end.matchedSources,1000);assert.equal(end.failedSources,0);assert.equal(end.pendingSources,0);assert.equal(updates[0].queriedSources,0);assert(updates.length>=400);assert(updates[0].records.every(r=>r.status==='pending'));
});
test('a hung source times out independently, preserves partial matches and continues',async()=>{
 const updates=[];const end=await runSourceQueue({entries:[{domains:['a.test','b.test']},{domains:['c.test']}],concurrency:1,entryTimeoutMs:25,onUpdate:s=>updates.push(s),runEntry:async(e,{onPartial})=>{if(e.domains.includes('a.test')){await onPartial({items:[{url:'https://sub.a.test/shoe'}]});return new Promise(()=>{});}return{items:[{url:'https://c.test/shoe'}]};}});
 assert.equal(end.queriedSources,3);assert.equal(end.failedSources,2);assert.equal(end.matchedSources,2);assert.equal(end.records[0].status,'error');assert(updates.some(s=>s.queriedSources===0&&s.matchedSources===1));
});
test('partial is visible before final gate, and different subdomains count as one source',async()=>{
 let release;const gate=new Promise(r=>release=r);let seen;const work=runSourceQueue({entries:[{domains:['a.test']}],onResult:async x=>{seen=x;},runEntry:async(e,{onPartial})=>{await onPartial({items:[{url:'https://x.a.test/shoe'},{url:'https://y.a.test/shoe'}]});await gate;return{items:[]};}});
 await new Promise(r=>setTimeout(r,5));assert(seen.partial);release();const end=await work;assert.equal(end.matchedSources,1);
});
test('resume skips completed entries independent of order and retries only unfinished/failed',async()=>{
 const entries=[{id:'done',domains:['a.test']},{id:'run',domains:['b.test']},{id:'fail',domains:['c.test']}];const previous=[{...entries[0],status:'done',matchedDomains:['a.test']},{...entries[1],status:'running'},{...entries[2],status:'error',error:'offline'}];
 const ran=[];const end=await runSourceQueue({entries:entries.toReversed(),previous,retryFailed:true,runEntry:async e=>{ran.push(e.id);return{items:[]};}});assert.deepEqual(ran.sort(),['fail','run']);assert.equal(end.queriedSources,3);assert.equal(end.matchedSources,1);
});
test('parent abort rejects immediately and late partial/final never write',async()=>{
 const ac=new AbortController();let writes=0;let release;const gate=new Promise(r=>release=r);
 const work=runSourceQueue({entries:[{domains:['a.test']}],signal:ac.signal,runEntry:async(e,{onPartial})=>{await gate;await onPartial({items:[{url:'https://a.test/shoe'}]});return{items:[]};},onResult:async()=>writes++});
 setTimeout(()=>ac.abort(),5);await assert.rejects(work,e=>e.name==='AbortError');release();await new Promise(r=>setTimeout(r,10));assert.equal(writes,0);
});
test('save callback failure rejects rather than reporting a successful source',async()=>{
 await assert.rejects(runSourceQueue({entries:[{domains:['a.test']}],runEntry:async()=>({items:[]}),onResult:async()=>{throw Error('save failed');}}),/save failed/);
});
