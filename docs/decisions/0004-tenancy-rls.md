# 0004 — Tenancy is enforced by Postgres row-level security

**Status:** accepted
**Date:** 2026-09-25

## Context

Every table except the shared job catalog carries `user_id`, and no query may cross
tenants (CLAUDE.md rule 5). Milestone 1.1 had to choose a mechanism that makes a
missing tenant filter hard to write, and it is expensive to change later. Three
candidates were considered:

- **A scoped repository wrapper.** It only covers queries built through the wrapper.
  Joins to other per-user tables, subqueries and raw `sql` go unfiltered, and the raw
  `db` stays reachable because the shared catalog needs it. Making it useful means
  reimplementing much of Drizzle's surface.
- **A custom lint rule.** It is syntactic, so helpers and indirection defeat it, and it
  does nothing for writes.
- **Row-level security (RLS).** Postgres applies it to every statement, whatever
  produced it: Drizzle, raw SQL, a script, Codex's code, or a psql session.

## Decision

Use Postgres RLS, with a thin application API on top.

- **Two roles.** The owner role runs migrations and owns every table. The app connects
  as `job_seeker_app`, which owns nothing and has neither SUPERUSER nor BYPASSRLS, so RLS
  always applies to it.
- **One policy per per-user table.** It is named `tenant_isolation`, applies to all
  commands, and uses `user_id = (select app.current_user_id())` as both USING and WITH
  CHECK. It is declared in the module's `schema.ts` via `tenantIsolation()`
  (`src/lib/db/tenancy.ts`).
- **`app.current_user_id()` raises `tenant not set`** when the setting is absent or
  empty. A forgotten scope is an error, never an empty result.
- **`withTenant(db, userId, work)`** sets `app.user_id` transaction-locally, which is
  safe under pooling, and restores the previous value on exit. Functions that touch
  per-user tables take a `TenantScope`, not a bare `Db`.
- **`src/lib/db/schema-invariants.test.ts`** fails when:
  - a table with `user_id` lacks RLS or has any policy other than `tenant_isolation`;
  - a table without `user_id` is missing from the shared-table allowlist;
  - the app role can bypass RLS.

## Rationale

This is the only option where forgetting the tenant is impossible for code, rather than
merely discouraged. It also blocks cross-tenant *writes*, which the other two options
don't address. The policy is the tenant filter, so services don't have to repeat
`where user_id = …`, though they may for readability.

## Consequences

- Per-user work always runs inside a transaction.
- Tests connect as `job_seeker_app` so they exercise the real policies.
- RLS is silently off for owners and superusers. Anything connecting with
  `DATABASE_ADMIN_URL` (migrations, bootstrap) must not serve requests.
- Cross-tenant background work never bypasses RLS. A fan-out lists ids from `users`,
  which isn't RLS-protected, then enqueues one job per user and runs each inside
  `withTenant`. Analytics (phase 4) is the first plausible bypass case, and it needs its
  own decision record.
- Production must provision `job_seeker_app` with LOGIN, and the migrating role must not be
  `job_seeker_app`.
- The same role split lets later milestones enforce other rules in the database. For
  example, `REVOKE UPDATE, DELETE ON raw_jobs FROM job_seeker_app` enforces rule 6
  (immutable raw payloads) in M1.4.
