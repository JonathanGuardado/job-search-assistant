# Eligibility eval — milestone 1.6

**Date:** 2026-10-21
**Dataset:** `evals/dataset.jsonl`, 84 real postings from the 26 captured boards, 126 labels
across three reference profiles (`evals/profiles.json`).
**Model:** `gemini-3.5-flash-lite`. **Run:** `pnpm eval:eligibility`.

| Profile | not_eligible | needs_review | eligible |
| --- | --- | --- | --- |
| `sv-remote` (the owner: El Salvador, remote only) | 65 | 7 | 12 |
| `us-remote` (contrast: US citizen, New York) | 7 | 2 | 23 |
| `sv-us-authorized` (the US-only trap from the other side) | 6 | 1 | 3 |

The labels were written before the extraction prompt existed, and the owner reviewed and
accepted them on 2026-10-21. One label was revised, for
the reason recorded in it: the Thunderbird posting's "unable to consider applicants
outside of these markets" sentence had been missed. Labeling from keyword-filtered
excerpts is how it was missed, so labels now come from the full posting.

## Results

| Run | Precision (≥ 95%) | Recall (≥ 80%) | needs_review (≤ 25%) | Quotes (≥ 98%) | Correct eligible (of 38) |
| --- | --- | --- | --- | --- | --- |
| Prompt v1 | 98.6% (72/73) | 90.0% | 14.3% | 100% | 34 |
| v1 + unquoted claims discarded (rule change, cached claims) | 98.6% (72/73) | 90.0% | 16.7% | 100% | 32 |
| Prompt v2: quote the location line, an optional office is not hybrid | 100% (68/68) | 85.0% | 23.0% | 99.3% | 29 |
| **Prompt v3: `quote` a required key in the output schema** | **98.6% (72/73)** | **90.0%** | **13.5%** | **99.4%** | **36** |

Prompt v3 is current. It meets every target. Structured fields alone decided 4 of 126.
The 80 extractions cost $0.10.

Each change, and why:

- **Unquoted claims discarded.** v1 accepted a `regions: [latam, namer]` claim with no
  quote, apparently inferred from "EST or PST working hours", and called a South America
  role eligible for a US candidate.
- **v2.** Asked for quotes from the location line, and said an optional office does not
  make a role hybrid. It fixed the false rejection of Canonical's "remote in AMER or
  EMEA, with the option of the London office", but the model kept omitting quotes on
  region claims.
- **v3.** Made the quote a required key in the schema the model is constrained to. That
  restored the correct "eligible" verdicts for Canonical's Americas roles.

## Remaining disagreements (v3)

- **One false rejection.** Canonical's DevRel posting: the location line says APAC/EMEA,
  the text says "Europe, Middle East, African and American time zones". It was labeled
  contradictory (`needs_review`); the engine followed the location line, with a valid
  quote.
- **Seven postings that give only a location.** "Switzerland", "United States", "London,
  United Kingdom", "Bangalore", "Brazil", plus Stripe's "based in the US" and Elastic's
  India role. They never say remote, hybrid or onsite, so the engine asks instead of
  assuming the role is located there (decision 0009, consequences).
- **Two scope statements the model did not turn into countries.** "Buenos Aires |
  Remote" and the location line "Canada". The engine asks instead of rejecting.

All of these except the first are `needs_review`. They cost the user attention, never a
hidden job.

## Holdout run (prompt v3, unchanged)

60 postings the prompt had never seen (99 labels: 47 / 5 / 8 for `sv-remote`, 9 / 2 / 20
for `us-remote`, 6 / 0 / 2 for `sv-us-authorized`), labeled from full text and committed
before the run (commit 1891637). One run, no changes.

| Metric | Holdout | Target |
| --- | --- | --- |
| Precision on not_eligible | **96.4%** (54/56) | ≥ 95% |
| Recall on not_eligible | **87.1%** (54/62) | ≥ 80% |
| needs_review share | **12.1%** | ≤ 25% |
| Quote validation rate | **100%** (110/110) | ≥ 98% |

Every target met on unseen postings.

- **Both false rejections are one posting.** Canonical's networking role lists "Home Based -
  Americas; Home Based - APAC; Office Based - Beijing; Office Based - Taipei", and the model
  read the office options as a hybrid role in China and Taiwan. This is the same failure
  the tuning set exposed (Canonical's "option to be based in our London office"). Prompt v2
  told the model an optional office is not hybrid, and it still happens.
- **Five wrong "eligible" verdicts, all for the US contrast candidate.**
  - Three are restrictions narrower than a country, which the rules cannot express: US
    West Coast, every state but New York, and commuting distance of the Bay Area. All
    three were predicted when labeling.
  - The other two are Toptal's "Canada, Central America, South America", extracted as
    regions `[latam, namer]`. `namer` includes the US, so "Canada" widened to all of North
    America. The scope claim cannot say "LATAM plus Canada".
- **Five "needs review" where a verdict was labeled.** These are location-only postings
  (Washington DC, "US"), the cautious miss.

A wrong "eligible" costs the user a few minutes; a false rejection hides a job. The
holdout's one false-rejection pattern is the thing to fix.

### What a fix needs

The principled fix is a rule, not another prompt edit: a posting that states a remote
scope the candidate fits is not an onsite-only role, so office options listed beside it
must not trigger `onsite-requires-relocation`. The evidence for it comes from the tuning
set (Canonical's FP&A role), but this holdout has now shown the failure too. If the fix is
made, measuring it on this holdout no longer counts as unseen: confirming it needs a
second fresh set.

## Caveats before the phase gate

- **Tuned on its own test set.** v2 and v3 were shaped by disagreements in the 84 tuning
  postings. The holdout run above is the unbiased measurement.
- **Size.** The spec aims for ~200 cases. 84 is enough to find failure modes, not to pin
  precision down: one false rejection moves it by about 1.4 points.
- **The pure US-only trap is thin.** No captured posting says only "must be authorized to
  work in the US" with no location restriction. It is covered by unit tests, not yet by
  real postings.
