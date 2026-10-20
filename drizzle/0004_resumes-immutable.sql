-- Resume versions are immutable (docs/domain-model.md). The default privileges
-- grant UPDATE on every new table; take it back for this one so an edit in place
-- is refused by the database, not merely avoided by the code.
REVOKE UPDATE ON TABLE resumes FROM job_seeker_app;
