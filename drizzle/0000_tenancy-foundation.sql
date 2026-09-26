-- Tenancy primitives. See docs/decisions/0004-tenancy-rls.md.
-- Hand-written: drizzle-kit does not manage functions or cluster-wide roles.

-- The runtime role. NOLOGIN here; `pnpm db:bootstrap` (local) or ops (production)
-- grants LOGIN. It must never own tables, be a superuser, or hold BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'jobhunt_app') THEN
    CREATE ROLE jobhunt_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
-- Raises instead of returning NULL: a query on a per-user table outside
-- withTenant() is a bug, and it should fail on the first test run.
-- An empty string means a previous transaction on this pooled connection set it.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
  tenant text := current_setting('app.user_id', true);
BEGIN
  IF tenant IS NULL OR tenant = '' THEN
    RAISE EXCEPTION 'tenant not set'
      USING HINT = 'Wrap per-user queries in withTenant() (src/lib/db/tenancy.ts).';
  END IF;
  RETURN tenant::uuid;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO jobhunt_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_id() TO jobhunt_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO jobhunt_app;
--> statement-breakpoint
-- Applies to every table the migrating role creates from here on.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jobhunt_app;
