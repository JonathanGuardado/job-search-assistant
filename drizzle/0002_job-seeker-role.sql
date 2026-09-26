-- Role provisioning and privileges are custom SQL because Drizzle only manages
-- the policy below. Roles are cluster-wide; development and tests share one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'job_seeker_app') THEN
    CREATE ROLE job_seeker_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app, public TO job_seeker_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_id() TO job_seeker_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO job_seeker_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO job_seeker_app;
--> statement-breakpoint
ALTER POLICY "tenant_isolation" ON "job_user_states" TO job_seeker_app USING (user_id = (select app.current_user_id())) WITH CHECK (user_id = (select app.current_user_id()));
--> statement-breakpoint
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM jobhunt_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM jobhunt_app;
--> statement-breakpoint
REVOKE USAGE ON SCHEMA app, public FROM jobhunt_app;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.current_user_id() FROM jobhunt_app;
