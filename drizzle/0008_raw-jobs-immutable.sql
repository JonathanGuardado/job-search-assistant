-- raw_jobs is the replay log (CLAUDE.md rule 6). The default privileges grant
-- UPDATE and DELETE on every new table; take both back so a mutation is refused
-- by the database, not merely avoided by the code.
REVOKE UPDATE, DELETE ON TABLE raw_jobs FROM job_seeker_app;
