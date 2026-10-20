import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createD1Sqlite } from '../d1-sqlite.mjs'
import { handlePersonalWorkbench } from '../src/personal-workbench.mjs'
const dir = mkdtempSync(join(tmpdir(), 'task-notes-')), file = join(dir, 'test.db')
let db = new DatabaseSync(file)
db.exec('PRAGMA foreign_keys=ON')
const migrations = join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations')
for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql')).sort()) db.exec(readFileSync(join(migrations, name), 'utf8'))
const auth = { role: 'personal-workbench', scope: 'personal-workbench', username: 'synthetic-owner' }
let env = { DB: createD1Sqlite(db) }
const base = '/api/personal-workbench/lifeos'
async function call(path, method = 'GET', body, principal = auth) {
 const req = new Request(`https://test.local${base}${path}`, { method, ...(body === undefined ? {} : {headers:{'content-type':'application/json'},body:JSON.stringify(body)}) })
 const response = await handlePersonalWorkbench(req, env, new URL(req.url), principal)
 return {status:response.status, body:await response.json()}
}
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ZkAAAAASUVORK5CYII='
try {
 const a = (await call('/tasks','POST',{title:'Notes parent'})).body
 const b = (await call('/tasks','POST',{title:'Notes child', parentTaskId:a.id})).body
 const path = `/tasks/${a.id}/notes`, other = `/tasks/${b.id}/notes`
 assert.equal((await call(path,'GET',undefined,null)).status,404)
 assert.equal((await call('/tasks/missing/notes')).status,404)
 assert.deepEqual((await call(path)).body.notes,[])
 for (const payload of [{content:'',images:[]},{content:'x'.repeat(20001),images:[]},{content:{},images:[]},{content:'x',images:Array(5).fill({name:'x',dataUrl:png})},{content:'x',images:[{name:'x',dataUrl:'data:image/svg+xml;base64,PHN2Zz4='}]},{content:'x',images:[{name:'x',dataUrl:'data:image/png;base64,aGVsbG8='}]}]) assert.equal((await call(path,'POST',payload)).status,400)
 let n = (await call(path,'POST',{content:'进展\n<script>literal text</script>',images:[{name:'截图.png',dataUrl:png}]})).body
 assert.ok(n.id); assert.equal(n.images.length,1); assert.equal(n.revision,1)
 assert.equal((await call(other)).body.notes.length,0)
 assert.equal((await call(`${other}/${n.id}`,'PATCH',{content:'wrong owner',images:[],expectedRevision:1})).status,404)
 assert.equal((await call(`${other}/${n.id}?revision=1`,'DELETE')).status,404)
 const imagePath = n.images[0].url.replace('/api','')
 const imageRequest = new Request(`https://test.local${base}${imagePath}`)
 const image = await handlePersonalWorkbench(imageRequest,env,new URL(imageRequest.url),auth)
 assert.equal(image.status,200); assert.equal(image.headers.get('content-type'),'image/png'); assert.match(image.headers.get('cache-control'),/no-store/)
 assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'),png.split(',')[1])
 const crossImage = new Request(`https://test.local${base}${imagePath.replace(a.id,b.id)}`)
 assert.equal((await handlePersonalWorkbench(crossImage,env,new URL(crossImage.url),auth)).status,404)
 assert.equal(JSON.stringify((await call(path)).body).includes('data:image'),false)
 n = (await call(`${path}/${n.id}`,'PATCH',{content:'edited',images:[{id:n.images[0].id}],expectedRevision:1})).body
 assert.equal(n.content,'edited'); assert.equal(n.revision,2); assert.equal(n.images.length,1)
 const auditBefore = db.prepare('SELECT count(*) AS n FROM personal_workbench_lifeos_audit_log').get().n
 const updatedBefore = db.prepare('SELECT updated_at FROM personal_workbench_lifeos_tasks WHERE id=?').get(a.id).updated_at
 assert.equal((await call(`${path}/${n.id}`,'PATCH',{content:'stale',images:[],expectedRevision:1})).status,409)
 assert.equal((await call(`${path}/${n.id}?revision=1`,'DELETE')).status,409)
 assert.equal(db.prepare('SELECT count(*) AS n FROM personal_workbench_lifeos_audit_log').get().n,auditBefore)
 assert.equal(db.prepare('SELECT updated_at FROM personal_workbench_lifeos_tasks WHERE id=?').get(a.id).updated_at,updatedBefore)
 // Force a same-revision race between the read and transactional CAS.
 const realBatch=env.DB.batch
 env.DB.batch=statements=>{db.prepare('UPDATE lifeos_task_notes SET revision=3 WHERE id=?').run(n.id);return realBatch(statements)}
 assert.equal((await call(`${path}/${n.id}`,'PATCH',{content:'racing loser',images:[],expectedRevision:2})).status,409)
 env.DB.batch=realBatch
 assert.equal(db.prepare('SELECT count(*) AS n FROM personal_workbench_lifeos_audit_log').get().n,auditBefore)
 assert.equal(db.prepare('SELECT updated_at FROM personal_workbench_lifeos_tasks WHERE id=?').get(a.id).updated_at,updatedBefore)
 db.prepare('UPDATE lifeos_task_notes SET revision=2 WHERE id=?').run(n.id)
 // Audit failure rolls back both the note and the task update.
 db.exec("CREATE TRIGGER reject_note_audit BEFORE INSERT ON personal_workbench_lifeos_audit_log WHEN NEW.action='task_note.create' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END")
 await assert.rejects(()=>call(path,'POST',{content:'must roll back',images:[]}),/synthetic rollback/)
 db.exec('DROP TRIGGER reject_note_audit')
 assert.equal((await call(path)).body.notes.length,1)
 assert.equal(db.prepare('SELECT updated_at FROM personal_workbench_lifeos_tasks WHERE id=?').get(a.id).updated_at,updatedBefore)
 db.close();db = new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');env = {DB:createD1Sqlite(db)}
 assert.equal((await call(path)).body.notes[0].content,'edited')
 const exported = (await call('/data/export')).body
 assert.equal(exported.data.taskNotes[0].taskId,a.id)
 assert.equal((await call('/data/import','POST',exported)).status,200)
 assert.equal((await call(path)).body.notes[0].images.length,1)
 const oldBackup = structuredClone(exported);delete oldBackup.data.taskNotes
 assert.equal((await call('/data/import','POST',oldBackup)).status,200)
 assert.equal((await call(path)).body.notes[0].id,n.id)
 for(let i=0;i<22;i++) assert.equal((await call(path,'POST',{content:`page ${i}`,images:[]})).status,201)
 const first = (await call(path)).body; assert.equal(first.notes.length,20); assert.ok(first.nextCursor)
 const second = (await call(`${path}?cursor=${first.nextCursor}`)).body
 assert.equal(second.notes.length,3);assert.equal(second.nextCursor,null)
 assert.equal(new Set([...first.notes,...second.notes].map(x=>x.id)).size,23)
 assert.equal((await call(`${other}?cursor=${first.nextCursor}`)).status,400)
 assert.equal((await call(`${path}/${n.id}?revision=2`,'DELETE')).status,200)
 assert.equal((await call(path)).body.notes.some(x=>x.id===n.id),false)
 await call(`/tasks/${a.id}`,'DELETE')
 assert.equal(db.prepare('SELECT count(*) n FROM lifeos_task_notes WHERE task_id=?').get(a.id).n,0)
 console.log('Task notes: persistence, image bytes, scope, conflict, pagination, backup, cascade passed')
} finally { db.close();rmSync(dir,{recursive:true,force:true}) }
