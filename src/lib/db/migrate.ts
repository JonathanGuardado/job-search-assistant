import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url))

/** Applies committed migrations. Must run as the owner role — the app role cannot create tables. */
export async function runMigrations(adminUrl: string): Promise<void> {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} })
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    await sql.end()
  }
}
