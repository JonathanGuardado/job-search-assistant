# 0009 — How the eligibility pipeline reads, decides and stores

**Status:** accepted
**Date:** 2026-10-21

## Context

Milestone 1.6 connected the rules (built in 1.1) to real postings. Measuring them
against 84 hand-labeled postings from the 26 captured boards, and tracing each
disagreement, showed several places where the original design would give wrong answers:

- Structured job fields almost never prove a candidate *can* take a job. A stage-1
  "eligible" for an onsite role meant "we did not read the posting", which skipped
  sentences like "authorized to work in Ireland, no sponsorship".
- Greenhouse gives no structured country for onsite roles, so the relocation rule could
  not decide most of them.
- The location rule read only the candidate's own country, and whether it could reject
  at all was going to be hardcoded.
- Region and scope statements are often in the title or location line ("Remote, United
  States"), not the description.
- The model regularly stated claims without quoting them, and an unquoted claim was being
  trusted.

## Decision

- **D1. Stage 1 can only reject.** Structured fields may prove a rejection, such as a
  hybrid role in Malta for a candidate who will not relocate. Anything short of that
  reads the posting. Every posting is read once per text version, shared across users
  (D6), so the cost is one extraction per posting.
- **D2. The model reads the title, location line and description**, and quotes may come
  from any of them.
- **D3. The onsite claim names its countries** (`onsite.countries`). The relocation rule
  uses them before the structured country.
- **D4. Onsite or hybrid work abroad implies a work-authorization requirement there.**
  Without held authorization, the posting's sponsorship statement decides: offered →
  pass, refused → reject with that quote, silent → `needs_review`. Silence about a
  *remote* role is still not evidence of a requirement.
- **D5. The candidate's own country always counts as authorized.**
- **D6. Claims are stored per job, not per user** (`job_eligibility_claims`, a shared
  table with no candidate data). Verdicts are per user (`eligibility_assessments`, RLS).
- **D8. Where a candidate can work comes from their settings, nothing is hardcoded.**
  - The location rule rejects only when the "Where you can work" setting is marked
    required.
  - A remote job is acceptable when its scope includes the candidate's country, a
    country they selected, or a region they live in or selected.
  - Selecting a region does not make a candidate resident in every country of it.
  - The settings page offers exactly the countries in the rule's region table.
- **D9. A remote scope the candidate fits outranks offices listed beside it** (engine
  v2, added 2026-10-22). "Home Based - Americas; Office Based - Beijing, China" is a
  remote role with optional offices. When the remote scope includes somewhere the
  candidate can work, the job counts as remote, and neither the relocation rule nor the
  authorization implied by D4 applies to the offices. When the scope excludes them, the
  office requirement stays in force. Found by the first holdout (both of its false
  rejections were one such Canonical posting), so a second holdout, labeled before any
  run, measures it.
- **D10. A posting that names only a place is flagged, not rejected** (engine v3, added
  2026-10-22). Live data showed 77% of the owner's first 877 verdicts as `needs_review`,
  almost all "does not say whether the role is remote or onsite": postings like "Bucharest,
  Romania" are far more common on real boards than in the labeled sets. Treating them as
  onsite would reject on an inference (CLAUDE.md rule 2), so the verdict stays
  `needs_review` and its reasons record `isLocationOnly`. Matching skips them unless the
  user overrides the verdict, and the jobs view (1.8) can group them as "probably onsite".
  Verdicts are unchanged: all three labeled sets score as under v2.
- **Unquoted claims are discarded.** A claim stating anything without a verbatim quote
  is reset to `unspecified`, like a claim whose quote is not in the posting. The model's
  output schema makes `quote` a required (nullable) key, because constrained decoding
  skipped the optional one.
- **Provider quotas pause the queue instead of failing jobs.** A 429 surfaces as
  `rate_limited`. The worker pauses for a minute and requeues the job without spending
  one of its attempts.

## Consequences

- Nearly every posting costs one extraction: about $0.0012 at `gemini-3.5-flash-lite`,
  or roughly $5 for the 4,200-job backlog. Later postings cost pennies a day.
- More postings land in `needs_review` for sponsorship (D4). This only applies to
  candidates willing to relocate; for the owner (remote only), the relocation rule
  rejects onsite roles abroad first.
- Postings that give only a city or country and never mention remote work stay
  `needs_review`. The labels call most of these "not eligible" for a remote-only
  candidate, so they cost recall (6 of the 8 recall misses at prompt v3), but never
  precision. Treating "a location with no mention of remote" as onsite is a candidate
  rule change for a later engine version, to be measured, not assumed.
- `docs/eligibility-spec.md` is updated to match: stage 1, the claims schema, quote
  validation, and the rule table.
