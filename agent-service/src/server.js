import { createServer } from 'node:http'
import postgres from 'postgres'
import { createHttpHandler } from './http.js'
import { PostgresPoolAdapter } from './postgres-pool-adapter.js'
import { PostgresStore } from './postgres-store.js'

const serviceToken = process.env.AGENT_SERVICE_TOKEN
const databaseUrl = process.env.DATABASE_URL
if (!serviceToken || !databaseUrl) {
  throw new Error('AGENT_SERVICE_TOKEN and DATABASE_URL are required')
}

const sql = postgres(databaseUrl, { max: Number(process.env.DB_POOL_SIZE ?? 8) })
const pool = new PostgresPoolAdapter(sql)
const store = new PostgresStore(pool)
await store.migrate()
const maxBudgetUsd = Number(process.env.AGENT_MAX_BUDGET_USD ?? 1)
const maxOutputTokens = Number(process.env.AGENT_MAX_OUTPUT_TOKENS ?? 4096)
const server = createServer(createHttpHandler({ store, serviceToken, maxBudgetUsd, maxOutputTokens }))
await new Promise((resolve) => server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0', resolve))

const shutdown = async () => {
  await new Promise((resolve) => server.close(resolve))
  await pool.end()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
