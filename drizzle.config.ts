import { defineConfig } from 'drizzle-kit'

// Generation only. Migrations are applied by `pnpm db:migrate` (src/lib/db/migrate.ts),
// which reads credentials through src/lib/env.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/*/schema.ts',
  out: './drizzle',
  entities: { roles: true },
})
