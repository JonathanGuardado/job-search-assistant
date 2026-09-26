import type { PgDatabase } from 'drizzle-orm/pg-core'
import { drizzle, type PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/lib/env'

/**
 * The executor every service function takes as its first argument. Both the
 * pooled database and an open transaction satisfy it, so callers decide the
 * transaction boundary and one transaction can span several modules.
 */
export type Db = PgDatabase<PostgresJsQueryResultHKT>

type Pool = { readonly db: Db; readonly close: () => Promise<void> }

export function connect(url: string, max: number): Pool {
  const sql = postgres(url, { max, idle_timeout: 20, onnotice: () => {} })
  return { db: drizzle(sql), close: () => sql.end() }
}

// Cached on globalThis so Next.js hot reloads reuse the pool instead of leaking one per reload.
const cache = globalThis as typeof globalThis & { __jobSeekerPool?: Pool }

/** The app-role pool. RLS applies to every connection it hands out. */
export function getDb(): Db {
  cache.__jobSeekerPool ??= connect(env.DATABASE_URL, env.DATABASE_POOL_MAX)
  return cache.__jobSeekerPool.db
}

export async function closeDb(): Promise<void> {
  const pool = cache.__jobSeekerPool
  delete cache.__jobSeekerPool
  await pool?.close()
}
