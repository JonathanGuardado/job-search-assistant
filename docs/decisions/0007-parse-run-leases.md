# 0007 — Parse runs are owned through an attempt lease

**Status:** accepted
**Date:** 2026-10-20

## Context

A `resume_parses` row is the record of one parse task over one resume version. Before
this decision, `startParse` restarted any row that had not succeeded, including one that
was still running. The tenant transaction lock serialized the start statements, but
nothing claimed the model call after commit. That allowed three failures:

- Two queue jobs for the same run (an upload job plus a retry, or BullMQ stalled-job
  recovery) could both call the model, spending twice.
- An older attempt could finish after a newer one and overwrite or fail its result.
- A worker that crashed left the row `running` forever, which also blocked deleting the
  resume.

The options were a lease on the row, a long-held row lock, or relying on BullMQ's own
job locks. A row lock would hold a pooled connection for the length of a model call,
which conventions forbid. BullMQ locks are per job, not per run, so two different jobs
for one run would not exclude each other.

## Decision

Each parse run carries an `attempt_id` and a `lease_expires_at`.

- **Claiming.** `startParse` claims a run only if it is new, `failed`, or `running` with
  an expired lease. Each claim writes a fresh `attempt_id` and a lease of five minutes
  (`PARSE_LEASE_MS`). A run under a live lease returns `in_progress`, and that job ends
  without calling the model.
- **Renewing.** The worker renews the lease every minute while the model call runs. A
  model call can take longer than the lease (provider timeouts plus a validation retry),
  so the lease is not sized to the slowest call.
- **Finishing.** `renewParseLease`, `completeParse` and `failParse` match on the attempt
  id. An attempt that lost its lease gets `conflict` and writes nothing, so its drafts
  are discarded.
- **Recovery.** A `running` row whose lease has expired is *stalled*
  (`isParseStalled`). The UI shows it as stopped and offers Try again, and deletion is
  no longer blocked by it. Nothing retries a stalled run automatically.
- **Invariant.** A CHECK keeps `lease_expires_at` set exactly when the status is
  `running`. The migration gives rows already running an expired lease.

Lease times use `clock_timestamp()`, not `now()`, because `now()` is fixed at the start
of a transaction.

## Consequences

- After a worker crash, the run stays stalled for up to five minutes before it can be
  retried. BullMQ's stalled-job recovery redelivers the job sooner, but that job sees the
  dead attempt's live lease and ends. The user retries after the lease lapses.
- A worker that loses its lease still finishes its model call, since the call cannot be
  cancelled, and that cost is not recorded on the run. This can only happen after
  renewals fail for five minutes.
- The same pattern applies to any later background task that runs a long model call
  over a per-user row (eligibility extraction in milestone 1.6). Reuse it there instead
  of designing a new one.
