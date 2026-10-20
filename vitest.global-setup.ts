import { ensureRoleAndDatabase } from './src/lib/db/bootstrap'
import { runMigrations } from './src/lib/db/migrate'
import { getEnv } from './src/lib/env'

/** Brings the test database to the committed schema once per run. */
export default async function setup(): Promise<void> {
  await ensureRoleAndDatabase({ adminUrl: getEnv().DATABASE_ADMIN_URL, appUrl: getEnv().DATABASE_URL })
  await runMigrations(getEnv().DATABASE_ADMIN_URL)
}
