# 0002 — Eligibility is three-valued

**Status:** accepted
**Date:** 2026-09-20

## Context

Most job tools present eligibility as a binary filter. Postings are frequently silent or
ambiguous about geographic and authorization constraints, so a binary filter is forced to
guess, and it guesses silently.

## Decision

Eligibility returns `eligible`, `not_eligible`, or `needs_review`, with a confidence
value and verbatim supporting quotes. `not_eligible` requires a quote; without one the
verdict is `needs_review`.

## Rationale

The two errors are not symmetric. A false `eligible` costs the user a few minutes of
reading. A false `not_eligible` costs them an opportunity they never learn exists.
Asymmetric costs demand an explicit uncertainty state rather than a threshold.

Storing evidence also makes the engine improvable: assessments are versioned, so a new
engine version can be diffed against the old one on the same data.

## Consequences

- Every UI surface displaying eligibility must render three states, not two.
- Auto-apply guardrails require `eligible` with high confidence and must never fire on
  `needs_review`.
- `needs_review` share is a tracked metric; above 25% the engine is not earning its keep.
- The Skipped Jobs view is mandatory, not optional — a hidden rejection the user cannot
  audit defeats the purpose of this decision.
