import { sql } from 'drizzle-orm'
import { pgPolicy, pgRole } from 'drizzle-orm/pg-core'
import type { Db } from './client.js'

/**
 * Tenancy is enforced by Postgres row-level security, not by query discipline.
 * See docs/decisions/0004-tenancy-rls.md.
 *
 * The app connects as `job_seeker_app`, which owns no tables, so RLS always
 * applies. `app.current_user_id()` (created in the first migration) raises
 * when no tenant is set, so a forgotten withTenant() fails loudly instead of
 * returning an empty result.
 */

// Created by the role migration and by `pnpm db:bootstrap`, never by drizzle-kit:
// roles are cluster-wide and the test database shares the cluster.
export const appRole = pgRole('job_seeker_app').existing()

// The sub-select makes Postgres evaluate the function once per statement, not per row.
const isCurrentTenant = sql`user_id = (select app.current_user_id())`

/** Every per-user table declares exactly this policy. schema-invariants.test.ts checks it. */
export const tenantIsolation = () =>
  pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    to: appRole,
    using: isCurrentTenant,
    withCheck: isCurrentTenant,
  })

/** Proof that the holder is inside withTenant(). Per-user service functions take this, not a bare Db. */
export type TenantScope = { readonly db: Db; readonly userId: string }

/**
 * Runs `work` in a transaction (a savepoint when already inside one) with the
 * tenant set. Commits when `work` resolves and rolls back when it throws, so a
 * service that needs to undo partial writes on an error result must throw.
 */
export async function withTenant<T>(
  db: Db,
  userId: string,
  work: (scope: TenantScope) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const [previous] = await tx.execute<{ tenant: string | null }>(
      sql`select current_setting('app.user_id', true) as tenant`,
    )
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`)
    const result = await work({ db: tx, userId })
    // Restore rather than clear, so a nested scope cannot erase or leak into its parent.
    await tx.execute(sql`select set_config('app.user_id', ${previous?.tenant ?? ''}, true)`)
    return result
  })
}
