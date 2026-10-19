import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFashionRouter } from '../router.mjs';
const temporary=await mkdtemp(join(tmpdir(),'fashion-migration-'));
async function service(){const route=createFashionRouter({dataDir:temporary,authorizeAdmin:async req=>req.headers['x-test-admin']==='1',photoSearch:false,fetcher:async()=>new Response('<rss><channel></channel></rss>',{headers:{'content-type':'application/xml'}})});const server=createServer((req,res)=>{route(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}}).catch(e=>{res.writeHead(500);res.end(e.message);});});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,base:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(r=>server.close(r))};}
test('migration keeps customer session/tasks across restart and isolates visitors/admin',async()=>{
 let app=await service();
 try{
  let response=await fetch(app.base+'/fashion',{redirect:'manual'});assert.equal(response.status,308);assert.equal(response.headers.get('location'),'/fashion/');
  response=await fetch(app.base+'/fashion/');assert.equal(response.status,200);assert.match(await response.text(),/鞋履设计工作台/);
  response=await fetch(app.base+'/fashion/app.js');assert.match(await response.text(),/API_BASE \+ "\/api"/);
  for(const path of ['/fashion/data/source-registry.json','/fashion/settings/sources','/fashion/source-library.html','/fashion/admin/server.mjs'])assert.equal((await fetch(app.base+path)).status,404);
  assert.equal((await fetch(app.base+'/fashion-admin/api/sources')).status,403);
  response=await fetch(app.base+'/fashion/api/session');const a=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];assert.equal(a.guest,true);assert.match(response.headers.get('set-cookie'),/Path=\/fashion\/.*Secure/);
  response=await fetch(app.base+'/fashion/api/tasks',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({subject:'women loafers',days:0})});assert.equal(response.status,201);const {task}=await response.json();
  for(let n=0;n<30;n++){const t=(await(await fetch(app.base+'/fashion/api/tasks/'+task.id,{headers:{cookie}})).json()).task;if(t.status!=='running')break;await new Promise(r=>setTimeout(r,20));}
  await app.close();app=await service();
  const restored=await(await fetch(app.base+'/fashion/api/session',{headers:{cookie}})).json();assert.equal(restored.account,a.account);
  assert.equal((await(await fetch(app.base+'/fashion/api/tasks',{headers:{cookie}})).json()).tasks[0].id,task.id);
  const b=await fetch(app.base+'/fashion/api/session');const cookieB=b.headers.get('set-cookie').split(';')[0];assert.notEqual((await b.json()).account,a.account);
  assert.equal((await fetch(app.base+'/fashion/api/tasks/'+task.id,{headers:{cookie:cookieB}})).status,404);
  response=await fetch(app.base+'/fashion/api/tasks',{method:'POST',headers:{cookie,origin:'https://attacker.example','content-type':'application/json'},body:'{}'});assert.equal(response.status,403);
  const headers={'x-test-admin':'1'};
  response=await fetch(app.base+'/fashion-admin/settings/sources',{headers});assert.equal(response.status,200);const html=await response.text();assert.match(html,/\/fashion-admin\/admin\.js/);assert.doesNotMatch(html,/127\.0\.0\.1/);
  response=await fetch(app.base+'/fashion-admin/api/sources',{headers});const catalog=await response.json();assert.equal(catalog.sources.length,1000);
  response=await fetch(app.base+'/fashion-admin/api/sources/'+catalog.sources[0].id,{method:'PATCH',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({revision:catalog.revision,changes:{note:'migration-test'}})});assert.equal(response.status,200);
  assert.equal(JSON.parse(await readFile(join(temporary,'source-admin.json'),'utf8')).revision,catalog.revision+1);
  for(const path of ['/migration.html','/migration.js','/legacy/rich.html','/legacy/local-api.js'])assert.equal((await fetch(app.base+'/fashion-admin'+path,{headers})).status,200);
  response=await fetch(app.base+'/fashion/api/search/materials',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(response.status,400);
 }finally{await app.close();await rm(temporary,{recursive:true,force:true});}
});
