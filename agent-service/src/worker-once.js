import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { PostgresPoolAdapter } from './postgres-pool-adapter.js'
import { PostgresStore } from './postgres-store.js'
import { createTimeoutBoundProviderCall, executeClaim } from './runner.js'
import { callProvider } from './providers.js'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const sql = postgres(process.env.DATABASE_URL, { max: 2 })
const store = new PostgresStore(new PostgresPoolAdapter(sql))
try {
  await store.migrate()
  const claim = await store.claimNext(`one-shot-${randomUUID()}`, 120_000)
  if (!claim) {
    process.stdout.write(`${JSON.stringify({ claimed: false, status: 'idle' })}\n`)
    process.exitCode = 0
  } else {
    const outcome = await executeClaim(claim, store, {
      providerCall: createTimeoutBoundProviderCall(callProvider, 50_000),
    })
    process.stdout.write(`${JSON.stringify({ claimed: true, runId: claim.run.id, ...outcome })}\n`)
  }
} finally {
  await sql.end()
}
