# 0003 — Defer LangGraph until phase 2

**Status:** accepted
**Date:** 2026-09-20

## Context

The project description names LangGraph as a candidate for agent workflows. Phase 1
workflows are linear: fetch, normalize, assess eligibility, assess match. No branching,
no pausing, no human checkpoint.

## Decision

Phase 1 uses BullMQ plus explicit status columns on `jobs` and assessment tables. Adopt
LangGraph at the phase 2 approval checkpoint, when a workflow must park indefinitely
awaiting a human decision.

## Rationale

A linear pipeline expressed in a graph framework is harder to debug than the same
pipeline expressed as queued jobs with status columns. The framework earns its cost at
the first genuine branch-and-pause, which is `APPLICATION_READY` in phase 2.

## Consequences

- Phase 1 state transitions must be durable writes so the phase 2 migration is a
  re-expression of existing states, not a rewrite.
- Workers stay idempotent and keyed from the start; this is a requirement either way.
- Revisit at milestone 2.5 (approval queue), not earlier.
