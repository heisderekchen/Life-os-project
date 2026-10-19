import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
async function setup(t,opts){const dir=await mkdtemp(join(tmpdir(),'fashion-full-queue-'));const app=createApp({dataDir:dir,guestPreview:true,...opts});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}/api`;const session=await fetch(base+'/session'),cookie=session.headers.get('set-cookie').split(';')[0],account=(await session.json()).account;
const call=async(path,data)=>{const response=await fetch(base+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data?JSON.stringify(data):undefined});return{code:response.status,...await response.json()}};t.after(async()=>{await Promise.allSettled([...app.jobs.values()]);await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true})});return{...app,dir,call,account};}
const input={subject:'nike',days:0,sourceScope:2,sources:['official','media','retail']};
test('HTTP queue runs all 1000 planned sources and persists private records without exposing catalogue',async t=>{
 const entries=Array.from({length:200},(_,i)=>({label:'来源检索',domains:Array.from({length:5},(_,j)=>`source${i*5+j}.test`)}));let queries=0;
 const fetcher=async value=>{queries++;const u=String(value);if(u.includes('bing.com'))throw Error('fixture alternate unavailable');return u.includes('/i.js?')?Response.json({results:[]}):new Response("vqd='4-123'");};
 const {call,jobs,dir,account}=await setup(t,{planSources:async()=>entries,fetcher});
 const {task}=await call('/tasks',input);await Promise.all([...jobs.values()]);
 const r=await call('/tasks/'+task.id);assert.equal(r.task.status,'review');assert.equal(r.task.progress.plannedSources,1000);assert.equal(r.task.progress.queriedSources,1000);assert.equal(r.task.progress.failedSources,0);assert.equal(r.task.progress.matchedSources,0);assert.equal(r.task.sourceQueue,undefined);assert(!JSON.stringify(r).includes('source999.test'));assert(queries>=600);
 const stored=JSON.parse(await readFile(join(dir,account+'.json'),'utf8')).tasks[0];assert.equal(stored.sourceQueue.records.length,200);assert(stored.sourceQueue.records.every(r=>r.status==='done'));
});
test('partial photos are available while remaining sources run beyond the short-search deadline',async t=>{
 let release;const gate=new Promise(r=>release=r);let held=true;
 const fetcher=async value=>{const u=new URL(value);if((u.searchParams.get('q')||'').includes('slow.test')&&held)await gate;
 if(u.hostname==='example.com')return new Response('<title>Nike shoes</title><img src="https://cdn.example.com/shoe.png">',{headers:{'content-type':'text/html'}});
 if(u.hostname==='cdn.example.com'){const png=Buffer.alloc(100);png[0]=137;png.write('PNG',1);png.writeUInt32BE(800,16);png.writeUInt32BE(600,20);return new Response(png,{headers:{'content-type':'image/png'}});}
 if(u.hostname.includes('bing.com'))throw Error('alternate unavailable');
 if(u.pathname==='/i.js')return Response.json({results:[{title:'Nike shoes',url:'https://example.com/shoe',image:'https://cdn.example.com/shoe.png'}]});return new Response("vqd='4-123'");};fetcher.trustedRelayHosts=new Set(['example.com','cdn.example.com']);
 const {call,jobs}=await setup(t,{searchTimeoutMs:100,planSources:async()=>[{label:'first',domains:['example.com']},{label:'slow',domains:['slow.test']}],fetcher});
 const {task}=await call('/tasks',input);let running;
 try{for(let i=0;i<40;i++){running=(await call('/tasks/'+task.id)).task;if(running.items.length)break;await new Promise(r=>setTimeout(r,5));}assert.equal(running.items.length,1);await new Promise(r=>setTimeout(r,120));running=(await call('/tasks/'+task.id)).task;assert.equal(running.status,'running');assert.equal(running.progress.plannedSources,2);assert.equal(running.progress.queriedSources,1);assert.equal(running.progress.matchedSources,1);assert.equal(running.progress.deadlineAt,null);
 const reviewed=await call('/tasks/'+task.id+'/review',{id:running.items[0].id,review:'verified',selected:true,note:'fixture source and photo matched'});assert.equal(reviewed.code,200);assert.equal(reviewed.task.status,'running');}finally{held=false;release();}
 await Promise.all([...jobs.values()]);const ended=(await call('/tasks/'+task.id)).task;assert.equal(ended.status,'review');assert.equal(ended.items.length,1);assert.equal(ended.progress.queriedSources,2);assert.equal(ended.items[0].selected,true);
});
