# 0008 — A duplicate is the same posting listed twice

**Status:** accepted
**Date:** 2026-10-21

## Context

Milestone 1.5 links duplicate jobs instead of showing them twice. The original plan
fingerprinted `(company, title, location_policy, remote_scope_key)` and linked collisions
whose descriptions were "similar above a threshold". The 4,189 postings captured from 26
boards in milestone 1.4 showed that both parts of that plan would hide real jobs.

**Most repeats are one role posted per location.** Of 375 same-title groups at a company,
329 are the same role in different places. Datadog lists "Strategic Account Executive"
once per region, Chile included. Eligibility depends on location, so merging these would
hide the one posting a candidate can take behind a canonical they cannot.

**Near-identical text is usually a different opening.** Pairs that share company, title
and location but differ slightly almost always differ in a detail eligibility depends on:

| Pair | Similarity (word 3-shingles) | The difference |
| --- | --- | --- |
| Twilio, Technical Account Manager 3, Remote Colombia | 0.962 | Pacific vs Eastern working hours |
| Twilio, Technical Support Engineer 2, Remote Ireland | 0.992 | Tuesday–Saturday vs Sunday–Thursday shifts |
| Stripe, Integration Engineer | 0.991 | 10 vs 5 |
| Stripe, Account Executive SMB Grower, Toronto | 0.987 | 3 vs 5 |
| Twilio, Strategic Account Executive, Remote UK | 0.89–0.93 | Northern vs southern territory; one needs Hebrew |
| Elastic, Senior vs Principal Java Engineer, Greece | 0.94 | Seniority and pay ($133k vs $191k) |

A threshold low enough to catch anything useful also merges these. Hiding a real opening
is the worse error here (eligibility spec): a missed duplicate costs one extra row in the
list, while a false merge removes a job the user never learns about.

`remote_scope` is not available at normalization time either: it is a claim the
eligibility engine extracts with a model (milestone 1.6), not a structured field.

## Decision

Two postings are duplicates only when they are **the same posting**: same company, same
title, same seniority, same location, and the same description once case, punctuation,
whitespace and identifiers of five or more digits (requisition numbers) are ignored.

- The fingerprint hashes `(company_normalized, title_normalized, seniority,
  location_policy, location_key, description words)`. An equal fingerprint is a duplicate;
  no similarity is computed and there is no threshold.
- `location_key` is the location text folded and with its `;`-separated parts sorted.
  The same role in two locations has two fingerprints.
- Seniority and level numerals are part of the identity: "Senior" and "Principal", or
  "Sourcer" and "Sourcer II", are different jobs.
- A cluster's canonical is its earliest-seen open member; the others point to it through
  `canonical_job_id`. Nothing is deleted. When a canonical closes, its earliest open
  duplicate is promoted, so an open posting is never hidden behind a closed one.
- Grouping one role's postings across locations ("also in 20 locations") is a display
  concern for the jobs UI (milestone 1.8), computed at query time. It is not a link.
- `job-sources` never imports `jobs`. The worker passes each poll page from one to the
  other.

## Consequences

- An edited repost (new id, changed text) is not linked. In the captured data, edits were
  material. The old posting closes once its board stops listing it.
- A posting published in two languages is not linked. Datadog lists its Japan and Korea
  roles in English and in Japanese or Korean (16 pairs, about 0.4% of visible jobs). This
  is the dominant missed-duplicate mode; see `docs/dedupe-sample.md`.
- One role posted under several requisitions with differently worded templates (MongoDB)
  shows more than once. The postings carry identical constraints, so the cost is noise,
  not a wrong eligibility result.
- Cross-board duplicates are linked only when both boards yield the same text. The
  Greenhouse and Lever text conversions differ, so this is unproven until a company is
  seeded on two boards. Revisit this decision with that data, not before.
