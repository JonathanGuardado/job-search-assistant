-- Application history is append-only, and applications are never deleted (decision 0012).
-- The default privileges grant UPDATE and DELETE on every new table; take back what these
-- tables must refuse, so the database enforces it rather than the code merely avoiding it.
REVOKE UPDATE, DELETE ON TABLE application_events FROM job_seeker_app;
--> statement-breakpoint
REVOKE DELETE ON TABLE applications FROM job_seeker_app;
