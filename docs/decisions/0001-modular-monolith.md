# 0001 — Modular monolith over services

**Status:** accepted
**Date:** 2026-09-20

## Context

The system has a dozen identifiable modules and a pipeline that fans out across
discovery, analysis, and application work. That shape invites premature service
extraction.

## Decision

One Next.js/TypeScript deployable, one PostgreSQL database, one Redis/BullMQ queue.
Module boundaries enforced in code: each module owns its tables and is imported only
through its `index.ts`.

## Rationale

The reasoning pipeline is the expensive, volatile part of this system, and it will change
shape repeatedly during phase 1. Services would freeze those boundaries before they are
understood and turn every schema change into a contract negotiation with yourself.

Boundaries are drawn so extraction later is mechanical rather than archaeological.

## Consequences

- Cross-module access must go through service interfaces even when a join would be easier.
- Background workers run in-process in development; they deploy separately when a queue's
  resource profile demands it, not before.
- Revisit only when a specific module has a resource or scaling profile the monolith
  cannot serve — Playwright in phase 3 is the first realistic candidate.
