import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { describe, expect } from 'vitest'
import type { Db } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { dbErrorFrom, dbTest as test } from '@/lib/db/testing'
import { ensureUser } from '@/modules/profiles'
import { jobUserStates } from './schema.js'
import { getJobUserState, setJobUserState } from './service.js'
import { aStoredJob } from './test-fixtures.js'

/**
 * These exercise the RLS policy on a real per-user table. They are the
 * executable form of docs/decisions/0004-tenancy-rls.md.
 */

async function twoUsersAndAJob(db: Db) {
  const alice = await ensureUser(db, { email: `alice-${randomUUID()}@test.local` })
  const bob = await ensureUser(db, { email: `bob-${randomUUID()}@test.local` })
  const job = await aStoredJob(db)
  return { alice, bob, job }
}

/**
 * Postgres evaluates the policy's tenant lookup lazily, on the first row it filters,
 * so an empty table answers an unscoped query with nothing rather than an error.
 * The fail-loudly tests seed a row so they never depend on what the database holds.
 */
async function aStoredState(db: Db) {
  const { alice, bob, job } = await twoUsersAndAJob(db)
  await withTenant(db, alice.id, (scope) => setJobUserState(scope, { jobId: job.id, state: 'saved' }))
  return { alice, bob, job }
}

describe('tenant isolation', () => {
  test('a per-user query outside withTenant fails loudly', async ({ db }) => {
    await aStoredState(db)
    const error = await dbErrorFrom(db, (d) => d.select().from(jobUserStates))
    expect(error).toContain('tenant not set')
  })

  test("a user cannot read another user's rows", async ({ db }) => {
    const { alice, bob, job } = await twoUsersAndAJob(db)
    await withTenant(db, alice.id, (scope) =>
      setJobUserState(scope, { jobId: job.id, state: 'saved' }),
    )

    const seenByBob = await withTenant(db, bob.id, (scope) => getJobUserState(scope, job.id))
    expect(seenByBob.ok).toBe(false)

    // Even with no user filter at all, the policy hides Alice's row.
    const rawRows = await withTenant(db, bob.id, ({ db: tx }) => tx.select().from(jobUserStates))
    expect(rawRows).toEqual([])
  })

  test("a user cannot modify another user's rows", async ({ db }) => {
    const { alice, bob, job } = await twoUsersAndAJob(db)
    await withTenant(db, alice.id, (scope) =>
      setJobUserState(scope, { jobId: job.id, state: 'saved' }),
    )

    const updated = await withTenant(db, bob.id, ({ db: tx }) =>
      tx
        .update(jobUserStates)
        .set({ state: 'ignored' })
        .where(eq(jobUserStates.jobId, job.id))
        .returning(),
    )
    expect(updated).toEqual([])

    const aliceState = await withTenant(db, alice.id, (scope) => getJobUserState(scope, job.id))
    expect(aliceState.ok && aliceState.value.state).toBe('saved')
  })

  test("writing a row for another user is rejected", async ({ db }) => {
    const { alice, bob, job } = await twoUsersAndAJob(db)
    const error = await dbErrorFrom(db, (d) =>
      withTenant(d, bob.id, ({ db: tx }) =>
        tx.insert(jobUserStates).values({ userId: alice.id, jobId: job.id, state: 'saved' }),
      ),
    )
    expect(error).toContain('row-level security')
  })

  test('the tenant does not outlive its scope', async ({ db }) => {
    const { alice } = await aStoredState(db)
    await withTenant(db, alice.id, async () => undefined)

    const error = await dbErrorFrom(db, (d) => d.select().from(jobUserStates))
    expect(error).toContain('tenant not set')
  })

  test('a nested scope restores the outer tenant', async ({ db }) => {
    const { alice, bob } = await twoUsersAndAJob(db)
    const current = async (d: Db) => {
      const [row] = await d.execute<{ tenant: string }>(
        sql`select app.current_user_id()::text as tenant`,
      )
      return row?.tenant
    }

    const seen = await withTenant(db, alice.id, async ({ db: outer }) => {
      const inner = await withTenant(outer, bob.id, ({ db: tx }) => current(tx))
      return { inner, after: await current(outer) }
    })
    expect(seen).toEqual({ inner: bob.id, after: alice.id })
  })

  test('a scope that throws rolls back its writes', async ({ db }) => {
    const { alice, job } = await twoUsersAndAJob(db)
    await expect(
      withTenant(db, alice.id, async (scope) => {
        await setJobUserState(scope, { jobId: job.id, state: 'saved' })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    const state = await withTenant(db, alice.id, (scope) => getJobUserState(scope, job.id))
    expect(state.ok).toBe(false)
  })
})
