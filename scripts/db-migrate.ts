import { runMigrations } from '@/lib/db/migrate'
import { env } from '@/lib/env'

await runMigrations(env.DATABASE_ADMIN_URL)
console.log('migrations applied')
