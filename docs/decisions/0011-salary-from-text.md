# 0011 — Salaries stated in a posting's text

**Status:** accepted
**Date:** 2026-10-22

## Context

Every job card said "no salary posted". Boards almost never fill a structured salary (2 of
4,176 captured postings; Greenhouse has no such field), but US pay-transparency laws put a
range in most descriptions: "$143,000—$190,000 USD" under "The reasonably estimated yearly
salary for this role is:". About 1,300 open postings state one.

## Decision

- **Parsed by plain code in `jobs` normalization** (`salary-text.ts`), not by a model. A
  structured salary wins; otherwise the range in the description, stored as a `posted`
  salary with the line it came from in the new column `jobs.salary_quote`. Normalization
  stays a pure function of the raw version, so `pnpm jobs:renormalize` backfills it.
- **Only what is clearly an annual salary.** The range needs a currency mark and must sit
  on, or under a heading that mentions, salary, compensation, pay, base or wages. Hourly and
  monthly rates, on-target earnings (they include commission), amounts under 10,000 or over
  10,000,000 a year, and postings with ranges in more than one currency stay unknown.
  Several ranges in one currency (per state, per zone) become one span from the lowest to
  the highest. A wrong number would put a false "below your floor" on a card, so a missed
  salary is the cheaper error.
- **Matching shows it; eligibility does not reject on it.** The salary rule can reject a
  job when the floor is required, and a parsing slip must not hide a job (CLAUDE.md:
  eligibility correctness first). Eligibility treats a salary that has a `salary_quote` as
  unknown. Letting eligibility use it, with the quote as evidence, would be a change to the
  rule set and needs its own decision.

## Consequences

- 1,292 of 4,176 open postings gain a salary. A dry run found no misread in a random sample
  of 25; the declines inspected were all deliberate (per-country tiers, a "$0.01" placeholder,
  a sales target).
- Matching engine v4 compares these salaries; existing matches are recomputed on the next
  re-match, without new model calls.
- `salary_quote` is additive. A CHECK keeps it null unless the salary is `posted`.
