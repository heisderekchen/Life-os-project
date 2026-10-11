import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { PostgresPoolAdapter } from './postgres-pool-adapter.js'
import { PostgresStore } from './postgres-store.js'
import { createTimeoutBoundProviderCall, executeClaim } from './runner.js'
import { callProvider } from './providers.js'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const sql = postgres(process.env.DATABASE_URL, { max: 2 })
const store = new PostgresStore(new PostgresPoolAdapter(sql))
const workerId = `${hostname()}-${randomUUID()}`
const pollMs = Math.max(1000, Math.min(Number(process.env.AGENT_WORKER_POLL_MS ?? 5000), 30000))
let stopping = false
process.once('SIGTERM', () => { stopping = true })
process.once('SIGINT', () => { stopping = true })

try {
  await store.migrate()
  while (!stopping) {
    try {
      await store.recordWorkerHeartbeat(workerId)
      const claim = await store.claimNext(workerId, 120_000)
      if (claim) {
        const outcome = await executeClaim(claim, store, {
          providerCall: createTimeoutBoundProviderCall(callProvider, 50_000),
        })
        process.stdout.write(`${JSON.stringify({ runId: claim.run.id, ...outcome })}\n`)
      } else {
        await new Promise(resolve => setTimeout(resolve, pollMs))
      }
    } catch (error) {
      process.stderr.write(`${JSON.stringify({ worker: 'loop', error: error?.message || 'WORKER_FAILED' })}\n`)
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
  }
} finally {
  await sql.end()
}
