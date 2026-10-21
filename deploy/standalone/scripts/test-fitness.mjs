import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createD1Sqlite } from '../d1-sqlite.mjs'
import { handlePersonalWorkbench } from '../src/personal-workbench.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys=ON; CREATE TABLE lifeos_schema_migrations(name TEXT PRIMARY KEY)')
const mark = db.prepare('INSERT INTO lifeos_schema_migrations(name) VALUES (?)')
for (const name of readdirSync(join(root, 'migrations')).filter(value => value.endsWith('.sql')).sort()) {
  db.exec(readFileSync(join(root, 'migrations', name), 'utf8')); mark.run(name)
}
const env = { DB: createD1Sqlite(db), PERSONAL_WORKBENCH_OWNER: 'alice' }
function client(username) {
  const auth = { role: 'personal-workbench', scope: 'personal-workbench', username }
  return async (path, method = 'GET', body) => {
    const request = new Request(`https://lifeos.test${path}`, { method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
    return handlePersonalWorkbench(request, env, new URL(request.url), auth)
  }
}
const alice = client('alice')
const bob = client('bob')
const rootPath = '/api/personal-workbench/lifeos/fitness'

assert.equal((await alice(`${rootPath}/plans`, 'POST', { name: 'Strength A', exercises: ['Squat', 'Row'], userId: 'bob' })).status, 201)
const plans = await (await alice(`${rootPath}/plans`)).json()
assert.equal(plans.length, 1)
assert.deepEqual(plans[0].exercises.map(exercise => exercise.name), ['Squat', 'Row'])
const sessionResponse = await alice(`${rootPath}/sessions`, 'POST', { planId: plans[0].id })
assert.equal(sessionResponse.status, 201)
const session = await sessionResponse.json()
assert.equal(session.status, 'active')
assert.equal((await alice(`${rootPath}/sessions/${session.id}/sets`, 'POST', { exerciseId: session.exercises[0].id, reps: 0, weightKg: 40 })).status, 400)
assert.equal((await alice(`${rootPath}/sessions/${session.id}/sets`, 'POST', { exerciseId: session.exercises[0].id, reps: 8, weightKg: 40 })).status, 201)
assert.equal((await alice(`${rootPath}/sessions/${session.id}`, 'PATCH', { status: 'completed' })).status, 200)
assert.equal((await alice(`${rootPath}/sessions/${session.id}/sets`, 'POST', { exerciseId: session.exercises[0].id, reps: 8, weightKg: 40 })).status, 404)
assert.deepEqual(await (await bob(`${rootPath}/plans`)).json(), [])
assert.deepEqual(await (await bob(`${rootPath}/sessions`)).json(), [])
assert.equal((await bob(`${rootPath}/sessions/${session.id}`)).status, 404)
assert.equal((await bob(`${rootPath}/sessions/${session.id}`, 'PATCH', { status: 'cancelled' })).status, 404)
assert.equal((await bob(`${rootPath}/sessions/${session.id}/sets`, 'POST', { exerciseId: session.exercises[0].id, reps: 8, weightKg: 40 })).status, 404)
assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
console.log('fitness API: plan, session, set validation, completion, and user isolation passed')
