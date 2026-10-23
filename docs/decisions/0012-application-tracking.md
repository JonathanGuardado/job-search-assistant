# 0012 — How applications are recorded

**Status:** accepted
**Date:** 2026-10-23

## Context

Milestone 1.9: "a real application is logged end to end and survives the posting going
offline." The domain model planned an `applications` table, an append-only
`application_events` log, and a `job_posting_snapshots` table holding a copy of each
posting's text, because postings disappear.

## Decision

- **No snapshot table.** Every version of every posting is already kept, verbatim and
  immutable, in `raw_jobs` (the app role has no UPDATE or DELETE on it; decision behind
  CLAUDE.md rule 6). An application stores the `raw_job_id` it was made against, and the
  posting as applied to is rebuilt from that version with
  `job-sources.readNormalizedPosting`, the same replay normalization uses. A copy would
  only duplicate it. `job_posting_snapshots` is removed from the domain model and the
  shared-table list; it was never created.
- **Only what 1.9 uses.** `mode`, `cover_letter` and `answers` belong to phases 2 and 3
  and are added then; additive columns are cheap.
- **Stages, freely ordered.** `applied`, `interviewing`, `offer`, `accepted`,
  `rejected`, `withdrawn`, `no_response`. Any stage may follow any other, because hiring
  is not linear, and every move is an `application_events` row with the day it happened
  (which the candidate may backdate) and when it was recorded.
- **History cannot be rewritten.** The app role has no UPDATE or DELETE on
  `application_events`, and no DELETE on `applications`: a mistaken entry is withdrawn,
  not removed. Events carry `user_id` for row-level security, and reference their
  application by `(application_id, user_id)`, because a foreign key alone bypasses RLS and
  would let one candidate's event attach to another's application.
- **One application per job and candidate.** Only jobs in the catalog; an application
  sent outside it is out of scope for 1.9.
- **Applying marks the job.** Creating an application also sets the job's
  `job_user_states` row to `applied`, in the same transaction, so the jobs view can show it.
- **A deleted resume leaves the application.** `resume_id` is set null if the candidate
  deletes that resume version; the rest of the record stands.

## Consequences

- The posting as applied to is always readable, even after the job closes, at no storage
  cost.
- Analytics (phase 4) reads time-in-stage from `application_events`.
- Retracting an application is a status, so counts of "applications sent" never drop.
