# Milestone 1.5 — Normalization and deduplication

**Owner:** Claude Code
**Done when:** duplicate rate is under 2% on a manually checked 100-job sample.

---

Implement raw → canonical normalization and cross-source deduplication.

**Normalization** runs as the `job-normalize` job on raw insert. It must be a pure
function of the raw payload so it can be replayed over stored `raw_jobs` when the logic
improves. Replay is the point of keeping raw data — make sure it actually works, and add
a script that reprocesses all raw jobs.

**Company normalization:** strip legal suffixes (Inc, LLC, GmbH, S.A. de C.V.),
punctuation, and case. Watch for the failure mode where two genuinely different companies
normalize to the same string.

**Title normalization:** strip board decorations and seniority variants into parsed
fields. "Senior Software Engineer II (Remote - LATAM)" yields a base title, a seniority,
and remote hints — the hints feed eligibility, they do not decide it.

**Fingerprint:** hash of `(company_normalized, title_normalized, location_policy,
remote_scope_key)`. On collision, compare description similarity; above threshold, link
via `canonical_job_id`.

**Link, never delete.** The UI shows "also posted on Lever" rather than silently dropping
a source. A deleted duplicate is unrecoverable; a linked one is not.

Test-first, with real examples pulled from the ingested data: same job on two boards,
two different jobs with identical titles at the same company, a reposted job with an
edited description, and a company that renamed itself.

Measuring the 2%: sample 100 jobs, check by hand, record the result in
`docs/dedupe-sample.md` with the date. If the rate is above 2%, report which failure mode
dominates rather than tuning the threshold until the number looks acceptable.
