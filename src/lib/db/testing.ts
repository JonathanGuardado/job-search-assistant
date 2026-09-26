import { TransactionRollbackError } from 'drizzle-orm'
import { test } from 'vitest'
import { getDb, type Db } from './client.js'

/**
 * Vitest fixture: each test gets a transaction on the app-role pool, rolled back
 * afterwards. Tests run as `job_seeker_app`, so they exercise the real RLS policies.
 */
export const dbTest = test.extend<{ db: Db }>({
  // Vitest requires the fixture's first parameter to be a destructuring pattern.
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    try {
      await getDb().transaction(async (tx) => {
        await use(tx)
        tx.rollback()
      })
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error
    }
  },
})

/**
 * Runs `work` in a savepoint and returns the database error text it raised, so a
 * test can assert on an expected failure without aborting its outer transaction.
 * Drizzle wraps driver errors, so the cause chain is flattened into one string.
 */
export async function dbErrorFrom(db: Db, work: (db: Db) => Promise<unknown>): Promise<string> {
  try {
    await db.transaction(async (savepoint) => {
      await work(savepoint)
    })
  } catch (error) {
    const messages: string[] = []
    for (let e: unknown = error; e instanceof Error; e = e.cause) messages.push(e.message)
    return messages.join(' <- ')
  }
  throw new Error('expected a database error, but the work succeeded')
}
