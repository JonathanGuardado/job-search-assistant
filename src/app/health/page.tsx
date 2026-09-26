import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { env } from '@/lib/env'
import { connectRedis } from '@/lib/queue'

export const dynamic = 'force-dynamic'

type Check = { readonly name: string; readonly ok: boolean; readonly detail: string }

async function check(name: string, probe: () => Promise<string>): Promise<Check> {
  try {
    return { name, ok: true, detail: await probe() }
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

async function checkPostgres(): Promise<string> {
  const [row] = await getDb().execute<{ role: string }>(sql`select current_user as role`)
  return `connected as ${row?.role ?? 'unknown'}`
}

async function checkRedis(): Promise<string> {
  const redis = connectRedis(env.REDIS_URL)
  try {
    return await redis.ping()
  } finally {
    redis.disconnect()
  }
}

export default async function HealthPage() {
  const checks = await Promise.all([check('postgres', checkPostgres), check('redis', checkRedis)])
  const healthy = checks.every((c) => c.ok)

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>{healthy ? 'Healthy' : 'Unhealthy'}</h1>
      <ul>
        {checks.map((c) => (
          <li key={c.name}>
            <strong>{c.name}</strong>: {c.ok ? 'ok' : 'failing'} — {c.detail}
          </li>
        ))}
      </ul>
    </main>
  )
}
