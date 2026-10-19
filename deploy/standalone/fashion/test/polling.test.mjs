import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';

test('task page polls running → empty completion, recovers connection errors and resumes on phone return', async t => {
  const dom = new JSDOM('<div id="root"></div><div id="notice"></div>', { url: 'https://happyspa.studio/fashion/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const task = { id: 'test-task', status: 'running', input: { subject: '乐福鞋', days: 7, sourceScope: 2, sources: ['official', 'media', 'retail'], domains: [] }, items: [], channels: [], message: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), progress: { stage: 'discover', startedAt: new Date().toISOString(), channelsDone: 1, totalChannels: 4 } };
  let current = task, offline = false, calls = 0;
  dom.window.requestJSON = async url => {
    calls++;
    if (offline) throw new Error('connection reset');
    return { response: { ok: true }, data: url.endsWith('/session') ? { account: 'guest-test', guest: true } : { tasks: [structuredClone(current)] } };
  };
  dom.window.scrollTo = () => {};
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import .*\n/, '');
  const app = await new Script('(async()=>{' + source + '\nreturn {go,refresh};})()').runInContext(dom.getInternalVMContext());
  app.go('detail', task.id);
  assert.match(dom.window.document.querySelector('[data-run-counts]').textContent, /1 \/ 4/);
  offline = true;
  await app.refresh();
  assert.equal(dom.window.document.querySelector('[data-run-connection]').hidden, false);
  assert.match(dom.window.document.querySelector('[data-run-connection]').textContent, /重新连接/);
  offline = false;
  current = { ...task, progress: { ...task.progress, stage: 'verify', checked: 4, candidates: 22, accepted: 0 } };
  await app.refresh();
  assert.match(dom.window.document.querySelector('[data-run-heading]').textContent, /核对/);
  assert.match(dom.window.document.querySelector('[data-run-counts]').textContent, /4 \/ 22/);
  current = { ...current, status: 'review', message: '9 条未能确认发布日期。本次未放宽日期要求。' };
  const before = calls;
  Object.defineProperty(dom.window.document, 'visibilityState', { value: 'visible', configurable: true });
  dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
  await new Promise(r => setImmediate(r));
  assert(calls > before);
  assert.equal(dom.window.document.querySelector('.run-state'), null);
  assert.match(dom.window.document.querySelector('.empty').textContent, /9 条未能确认发布日期/);
  assert(dom.window.document.querySelector('[data-action="retry"]'));
});

test('queued gallery separates source counts from photo counts and reveals results in pages',async t=>{
 const dom=new JSDOM('<div id="root"></div><div id="notice"></div>',{url:'https://happyspa.studio/fashion/',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const task={id:'large',status:'running',input:{subject:'nike',days:0,sourceScope:2,sources:['official','media','retail'],domains:[]},items:Array.from({length:70},(_,i)=>({id:'photo'+i,title:'Nike shoes '+i,url:'https://example.com/shoe/'+i,source:'example.com',image:'https://cdn.example.com/'+i+'.jpg',imageSha256:String(i).padStart(64,'0'),review:'pending',selected:false,note:'',summary:''})),channels:[],message:'',createdAt:new Date().toISOString(),progress:{stage:'source-queue',plannedSources:1000,queriedSources:50,matchedSources:2,failedSources:5,accepted:70}};
 dom.window.requestJSON=async url=>({response:{ok:true},data:url.endsWith('/session')?{account:'guest-test',guest:true}:{tasks:[structuredClone(task)]}});dom.window.scrollTo=()=>{};
 const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import .*\n/,'');const app=await new Script('(async()=>{'+source+'\nreturn {go};})()').runInContext(dom.getInternalVMContext());app.go('detail',task.id);
 assert.match(dom.window.document.querySelector('[data-run-counts]').textContent,/50 \/ 1000/);assert.match(dom.window.document.querySelector('[data-run-counts]').textContent,/有素材 2 个/);assert(!dom.window.document.querySelector('[data-run-clock]').textContent.includes('90'));
 assert.equal(dom.window.document.querySelectorAll('[data-result]').length,60);await dom.window.document.querySelector('[data-action="more-results"]').onclick();assert.equal(dom.window.document.querySelectorAll('[data-result]').length,70);assert(dom.window.document.querySelector('[data-review]'));assert.equal(dom.window.document.querySelector('[data-review] [name="review"]').disabled,false);
});
