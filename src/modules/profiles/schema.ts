import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * The tenant list. Not row-level secured: it holds no candidate data, and
 * fan-out jobs read it to enqueue one tenant-scoped job per user.
 * Candidate constraints arrive in milestone 1.2 as `candidate_profiles`.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
