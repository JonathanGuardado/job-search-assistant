import { ensureRoleAndDatabase } from '@/lib/db/bootstrap'
import { connect } from '@/lib/db/client'
import { runMigrations } from '@/lib/db/migrate'
import { DEV_USER } from '@/lib/dev-user'
import { env } from '@/lib/env'
import { ensureUser } from '@/modules/profiles'

/**
 * One-time local setup, safe to re-run: app login role, database, migrations,
 * and the hardcoded dev user.
 */
await ensureRoleAndDatabase({ adminUrl: env.DATABASE_ADMIN_URL, appUrl: env.DATABASE_URL })
await runMigrations(env.DATABASE_ADMIN_URL)

const admin = connect(env.DATABASE_ADMIN_URL, 1)
try {
  const user = await ensureUser(admin.db, { id: DEV_USER.id, email: DEV_USER.email })
  console.log(`bootstrap complete; dev user ${user.email} (${user.id})`)
} finally {
  await admin.close()
}
