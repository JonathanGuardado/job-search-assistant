# Milestone 1.9 — Application tracking

**Owner:** Codex (brief written by Claude Code)
**Done when:** a real application is logged end to end and survives its posting going
offline.

---

Build manual application tracking — the lightweight ATS from the candidate's side.

**The durability requirement comes first.** When an application is created, capture a
`job_posting_snapshot` with the full description text. Postings disappear, sometimes
within days, and the record has to outlive them. A tracked application whose job
description is a dead link is worthless six weeks later when a recruiter calls.

**Status pipeline**

```
Draft → Applied → Recruiter Contact → Screening → Technical Interview
  → Final Interview → Offer
```

Plus `Rejected` and `Withdrawn`, reachable from any active state. `Awaiting Approval`
exists in the enum but is unused until phase 2.

**Status changes are append-only events.** Write an `application_events` row for every
transition with actor and timestamp. Never overwrite `status` without the event. This log
is what makes phase 4's analytics nearly free — time-in-stage and conversion rates fall
out of it.

**Stored per application:** the job snapshot, source URL, resume version used, cover
letter, answers, salary submitted, application date, recruiter contact, interview dates,
notes, and outcome reason.

**Views:** a pipeline board grouped by status, a detail view with the full timeline, and
quick entry from a job detail page ("I applied to this").

No generation, no auto-apply, no approval queue, no analytics dashboard. The user writes
their own cover letter for now; the system only records what was sent.

Tests: the event log invariant (status never changes without an event), and snapshot
capture at creation time.
