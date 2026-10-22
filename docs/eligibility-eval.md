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

## Caveats before the phase gate

- **Tuned on its own test set.** v2 and v3 were shaped by disagreements in these 84
  postings. Before trusting the numbers, label a fresh set the prompt has never seen and
  run it once, unchanged.
- **Size.** The spec aims for ~200 cases. 84 is enough to find failure modes, not to pin
  precision down: one false rejection moves it by about 1.4 points.
- **The pure US-only trap is thin.** No captured posting says only "must be authorized to
  work in the US" with no location restriction. It is covered by unit tests, not yet by
  real postings.
