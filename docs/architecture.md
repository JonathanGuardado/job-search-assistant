# Architecture

Modular monolith. One Next.js/TypeScript repository, one deployable, one database, one
queue. Module boundaries are enforced in code, not by network hops.

## Why not services

The expensive part of this system is the reasoning pipeline, and that pipeline changes
shape constantly during early development. Distributed services freeze those boundaries
before they are understood, and every schema change becomes a versioned contract
negotiation with yourself.

The modules below are drawn so that extracting one later is mechanical: each owns its
tables and is reached only through a typed interface.

## Pipeline

```
source adapters → raw job store → normalize + dedupe → eligibility → matching
  → jobs view → application prep → approval gate → submit + verify → tracking
```

Everything left of the jobs view is background work driven by BullMQ. Everything right
of it is user-driven and interactive. That split is load-bearing: discovery and analysis
must survive restarts and run on a schedule; application work is latency-sensitive.

## Modules

| Module | Owns | Calls a model |
| --- | --- | --- |
| `profiles` | Candidate constraints, hard vs preferred | No |
| `resumes` | File storage, immutable versions, text extraction, parse run records | No |
| `career-knowledge` | Structured career record; the resume extraction task | Extraction only |
| `job-sources` | Adapters, polling cursors, raw capture | No |
| `jobs` | Normalization, dedupe, canonical model, open/closed state | No |
| `eligibility` | Rules, extraction, three-state verdicts | Extraction only |
| `matching` | Requirement extraction, comparison and explanation (decision 0010) | Extraction only |
| `applications` | Pipeline state, artifacts, status history | No |
| `application-answers` | Question classification, grounded answers | Generation |
| `automation` | Playwright flows, submission verification (phase 3) | Fallback only |
| `analytics` | Funnel metrics, source performance | No |
| `ai` | Provider abstraction, schemas, validation, tracing | n/a |

## Module contract

```
src/modules/<name>/
  index.ts       # the ONLY file other modules may import
  service.ts     # business logic
  schema.ts      # Drizzle tables owned by this module
  types.ts       # domain types + Zod schemas
  *.test.ts
```

Rules:

- A module may import another module's `index.ts` and nothing deeper.
- A module may only write to tables declared in its own `schema.ts`.
- Cross-module reads go through service interfaces, never through raw joins across
  ownership boundaries. (Read-only reporting queries in `analytics` are the exception,
  and must be marked as such.)
- Shared primitives (result types, dates, errors, logging) live in `src/lib/`, which
  depends on nothing.

## Background work

BullMQ workers run in their own process, started with `pnpm worker` (`src/worker.ts`),
in development and in production. A queue is declared with `defineQueue(name,
payloadSchema)` (`src/lib/queue.ts`) next to the module that owns its handler, and is
exported from that module's `index.ts`. Queues:

| Queue | Job | Schedule |
| --- | --- | --- |
| `source-poll` | Fetch one page from one source | Cron per source |
| `job-normalize` | One raw version → its job, then duplicate links | Per poll page, for new or changed postings |
| `assess-eligibility` | One candidate × one job | After a job is normalized; after a profile save (via `eligibility-reassess-user`) |
| `eligibility-reassess-user` | Queue every open job for one candidate | On profile save |
| `assess-match` | One candidate × one job eligibility did not reject | After eligibility; after a profile or career-record change (via `match-reassess-user`) |
| `match-reassess-user` | Queue every job not rejected for one candidate | On profile save, career-item edit, resume deletion, finished parse |
| `resume-parse` | One resume version → draft career items | On upload |

Every job is idempotent and keyed so a retry cannot double-write. Workflows are state
machines with persisted state: a crash resumes at the last committed step.

## Tenancy

Postgres row-level security enforces tenant isolation (decision 0004). The app connects
as `job_seeker_app`, which owns no tables. Per-user work runs inside
`withTenant(db, userId, …)`, and service functions that touch per-user tables take a
`TenantScope`. A query outside a scope fails with `tenant not set` once it reaches a row.
Postgres evaluates the policy lazily, so the same query on an empty table returns nothing
instead of failing. That leaks nothing, but it means the error is not a guarantee.

## Workflow engine

Use BullMQ plus explicit status columns until workflows actually branch and pause.
Adopt LangGraph at the phase 2 approval checkpoint, when a workflow must park
indefinitely waiting for a human. Recorded in `docs/decisions/0003-workflow-engine.md`.

## LLM boundary

All model access goes through `src/modules/ai`. Callers never touch a provider SDK.

```ts
const result = await callModel({
  task: 'eligibility.extract',   // named, versioned task
  schema: EligibilityClaimsSchema, // Zod — output is typed and validated
  input: { description },
})
```

The `ai` module is responsible for: provider selection per task, prompt versioning,
schema validation, retry on validation failure, cost and latency logging, and storing the
trace against the calling record. A task name maps to a model in config, so swapping
models is a config change and is logged.

The provider is selected with `AI_PROVIDER=deepseek|gemini`. Both adapters live
inside `ai` and use native HTTP; product tasks keep the same `callModel` interface.
`MODEL_EXTRACTION` and `MODEL_REASONING` select model IDs. Provider-specific usage
is normalized before tracing, and `AI_MODEL_PRICING` can supply rates for new models
without editing code. See [provider setup](ai-providers.md) for configuration and
cost-estimate limitations.

## What is deliberately absent

No event bus, no CQRS, no plugin system, no microservices, no GraphQL, no ORM beyond
Drizzle, no state management library beyond React and server components. Add any of these
only with a decision record explaining the concrete problem it solves.
