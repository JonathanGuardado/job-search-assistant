import { sql } from 'drizzle-orm'
import { describe, expect } from 'vitest'
import { dbTest as test } from './testing.js'

/**
 * Guards the tenancy model against drift. A new table with a user_id column but
 * no policy, a new shared table nobody decided on, or an app role that can skip
 * RLS all fail here. See docs/decisions/0004-tenancy-rls.md.
 */

// Tables without user_id. Adding one is a deliberate decision recorded in docs/domain-model.md.
const SHARED_TABLES = ['job_eligibility_claims', 'job_posting_snapshots', 'job_sources', 'jobs', 'raw_jobs', 'users']

type TableRow = {
  table: string
  has_user_id: boolean
  rls_enabled: boolean
  owner: string
  policies: { name: string; cmd: string; roles: string[]; qual: string; check: string }[]
}

describe('schema invariants', () => {
  test('tests run as the app role, which cannot bypass RLS', async ({ db }) => {
    const [role] = await db.execute<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    )
    expect(role).toEqual({ current_user: 'job_seeker_app', rolsuper: false, rolbypassrls: false })
  })

  test('every per-user table has exactly the tenant policy, and every other table is on the shared list', async ({ db }) => {
    const tables = await db.execute<TableRow>(sql`
      select
        c.relname as table,
        exists (
          select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
        ) as has_user_id,
        c.relrowsecurity as rls_enabled,
        pg_get_userbyid(c.relowner) as owner,
        coalesce((
          select json_agg(json_build_object(
            'name', p.policyname, 'cmd', p.cmd, 'roles', p.roles,
            'qual', p.qual, 'check', p.with_check))
          from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname
        ), '[]'::json) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname
    `)

    expect(tables.length).toBeGreaterThan(0)
    for (const t of tables) {
      // Owners bypass RLS unless it is forced, so the app role must own nothing.
      expect(t.owner, t.table).not.toBe('job_seeker_app')

      if (!t.has_user_id) {
        expect(SHARED_TABLES, `${t.table} has no user_id and is not a declared shared table`).toContain(t.table)
        continue
      }

      expect(t.rls_enabled, `${t.table} must enable row-level security`).toBe(true)
      // Permissive policies are OR-ed together, so any extra policy could widen access.
      expect(t.policies, `${t.table} must have exactly the tenant_isolation policy`).toHaveLength(1)
      const [policy] = t.policies
      expect(policy).toMatchObject({ name: 'tenant_isolation', cmd: 'ALL', roles: ['job_seeker_app'] })
      for (const expression of [policy?.qual, policy?.check]) {
        expect(expression).toMatch(/^\(user_id = \( SELECT app\.current_user_id\(\)/)
      }
    }
  })
})
