# 0005 — Align local storage names with Job Seeker Assistant

**Status:** accepted
**Date:** 2026-09-25

## Context

The user renamed the project and confirmed that no data needs preserving in the
local development databases. The initial migration files have already run locally,
so they remain unchanged.

## Decision

- Recreate the project's local Postgres volume and development/test databases.
- Name the databases `job_seeker` and `job_seeker_test`, and the runtime role
  `job_seeker_app`.
- Invoke Compose with `-p job-seeker-assistant` and use volume key
  `job-seeker-pg`, so container and volume names do not depend on the checkout path.
  The explicit flag supports the installed Compose version, which predates the
  top-level `name` configuration field.
- Add a migration that creates the new runtime role if absent, grants its schema,
  function, table, and default table privileges, switches the tenant policy, and
  revokes the old role's privileges in the migrated database.
- Preserve the original migrations and snapshots. The historical role may remain
  in the cluster because roles are shared across databases. On a fresh install it
  has NOLOGIN and no application privileges after the migration.

## Consequences

The user-authorized reset is specific to this empty local installation. It is not
a production data migration or a reusable instruction to delete existing data.
Other installations must migrate each database and coordinate their connection
settings before switching runtime roles. Existing database names need not change
to apply the role migration. Login credentials for the new role are provisioned by
local bootstrap or by production operations.

The app still owns no tables and has neither SUPERUSER nor BYPASSRLS. The existing
integration tests verify tenant isolation under the new role. External Redis is
unaffected by the local Postgres reset.
