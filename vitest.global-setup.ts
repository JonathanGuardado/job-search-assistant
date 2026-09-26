import { ensureRoleAndDatabase } from './src/lib/db/bootstrap'
import { runMigrations } from './src/lib/db/migrate'
import { env } from './src/lib/env'

/** Brings the test database to the committed schema once per run. */
export default async function setup(): Promise<void> {
  await ensureRoleAndDatabase({ adminUrl: env.DATABASE_ADMIN_URL, appUrl: env.DATABASE_URL })
  await runMigrations(env.DATABASE_ADMIN_URL)
}
