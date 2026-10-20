import { runMigrations } from '@/lib/db/migrate'
import { getEnv } from '@/lib/env'

await runMigrations(getEnv().DATABASE_ADMIN_URL)
console.log('migrations applied')
