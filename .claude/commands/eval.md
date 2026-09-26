---
description: Run the eligibility eval suite and interpret the result
argument-hint: "[optional: what changed since the last run]"
---

Run the eligibility regression suite and report honestly.

1. Run `pnpm eval:eligibility`.
2. Report the four tracked metrics from `docs/eligibility-spec.md` against their targets:
   precision on `not_eligible`, recall on `not_eligible`, `needs_review` share, and quote
   validation rate.
3. List every case that regressed since the last stored run, with the posting's
   distinguishing feature and what the engine got wrong.
4. Check specifically for the US-only trap: cases where authorization language was read
   as a location restriction. A regression there is a release blocker.
5. Report the override signal — any rule id the user has overridden more than twice.

Context for this run: $ARGUMENTS

Do not summarize a failing run as progress. If precision on `not_eligible` is below 0.95,
say the change is not shippable and propose the narrowest fix that addresses the specific
failing cases rather than a broad prompt rewrite.
