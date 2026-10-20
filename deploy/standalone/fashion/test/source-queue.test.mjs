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
test('open discovery queue entries run without changing the 1000-domain source counters',async()=>{
 let ran=0;
 const end=await runSourceQueue({entries:[{label:'公开网页发现',domains:[],openDiscovery:true,readerVersion:2}],
   runEntry:async()=>{ran++;return{items:[{url:'https://editorial.example/shoe-story'}]};}});
 assert.equal(ran,1);
 assert.equal(end.plannedSources,0);
 assert.equal(end.queriedSources,0);
 assert.equal(end.pendingSources,0);
 assert.equal(end.records[0].status,'done');
 assert.equal(end.records[0].openDiscovery,true);
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
test('reader upgrade reruns a done legacy-schema catalogue record and preserves its checkpoint for resumable work',async()=>{
 const entry={id:'catalog',domains:['nike.com'],readerVersion:3,timeoutMs:50};
 const previous=[{...entry,status:'done',readerVersion:2,checkpoint:{next:'https://api.nike.com/next'}}];
 let calls=0;
 const end=await runSourceQueue({entries:[entry],previous,previousReaderVersion:2,retryFailed:true,
   runEntry:async(e,{checkpoint,onPartial})=>{
     calls++;
     assert.equal(checkpoint.next,'https://api.nike.com/next');
     await onPartial({checkpoint:{...checkpoint,next:'https://api.nike.com/next?anchor=48'},items:[]});
     return{checkpoint:{...checkpoint,next:'https://api.nike.com/next?anchor=72'},items:[]};
   }});
 assert.equal(calls,1);
 assert.equal(end.records[0].status,'done');
 assert.equal(end.records[0].readerVersion,3);
 assert.equal(end.records[0].checkpoint.next,'https://api.nike.com/next?anchor=72');
});
test('Adidas reader v5 reruns a done v4 catalogue while preserving sibling checkpoints and resumes v5 work',async()=>{
 const entries=[
   {id:'adidas-catalog',domains:['adidas.com.cn'],readerVersion:5},
   {id:'media-done',domains:['media.test'],readerVersion:2},
   {id:'other-done',domains:['other.test'],readerVersion:3},
 ];
 const previous=[
   {...entries[0],status:'done',readerVersion:4,checkpoint:{frontier:['https://www.adidas.com.cn/pdp?articleId=OLD']}},
   {...entries[1],status:'done',readerVersion:2,checkpoint:{token:'media-checkpoint'}},
   {...entries[2],status:'done',readerVersion:3,checkpoint:{token:'other-checkpoint'}},
 ];
 const calls=[];
 const upgraded=await runSourceQueue({entries,previous,previousReaderVersion:4,retryFailed:true,runEntry:async(e,{checkpoint})=>{
   calls.push(e.id);
   assert.deepEqual(checkpoint,{frontier:['https://www.adidas.com.cn/pdp?articleId=OLD']});
   return{checkpoint:{frontier:['https://www.adidas.com.cn/pdp?articleId=NEW'],visited:['https://www.adidas.com.cn/siteMap']},items:[]};
 }});
 assert.deepEqual(calls,['adidas-catalog']);
 assert.deepEqual(upgraded.records.find(r=>r.id==='media-done').checkpoint,{token:'media-checkpoint'});
 assert.deepEqual(upgraded.records.find(r=>r.id==='other-done').checkpoint,{token:'other-checkpoint'});
 const interrupted=upgraded.records.map(r=>r.id==='adidas-catalog'?{...r,status:'error',error:'interrupted'}:{...r});
 calls.length=0;
 const resumed=await runSourceQueue({entries,previous:interrupted,previousReaderVersion:5,retryFailed:true,runEntry:async(e,{checkpoint})=>{
   calls.push(e.id);
   assert.equal(checkpoint.frontier[0],'https://www.adidas.com.cn/pdp?articleId=NEW');
   return{checkpoint:{...checkpoint,complete:true},items:[]};
 }});
 assert.deepEqual(calls,['adidas-catalog']);
 assert.equal(resumed.records.find(r=>r.id==='adidas-catalog').readerVersion,5);
 assert.deepEqual(resumed.records.find(r=>r.id==='media-done').checkpoint,{token:'media-checkpoint'});
});
test('parent abort rejects immediately and late partial/final never write',async()=>{
 const ac=new AbortController();let writes=0;let release;const gate=new Promise(r=>release=r);
 const work=runSourceQueue({entries:[{domains:['a.test']}],signal:ac.signal,runEntry:async(e,{onPartial})=>{await gate;await onPartial({items:[{url:'https://a.test/shoe'}]});return{items:[]};},onResult:async()=>writes++});
 setTimeout(()=>ac.abort(),5);await assert.rejects(work,e=>e.name==='AbortError');release();await new Promise(r=>setTimeout(r,10));assert.equal(writes,0);
});
test('save callback failure rejects rather than reporting a successful source',async()=>{
 await assert.rejects(runSourceQueue({entries:[{domains:['a.test']}],runEntry:async()=>({items:[]}),onResult:async()=>{throw Error('save failed');}}),/save failed/);
});
