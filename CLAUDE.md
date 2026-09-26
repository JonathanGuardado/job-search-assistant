# Job Seeker Assistant

A multi-user job search assistant. Its defining capability is **eligibility reasoning**:
deciding whether a specific candidate can actually take a specific "remote" job, and
showing the evidence it used.

Everything else (discovery, matching, applications, tracking) is supporting cast.
When a tradeoff arises, protect eligibility correctness first.

## Read before implementing

| File | When |
| --- | --- |
| `docs/architecture.md` | Any change touching module boundaries or background jobs |
| `docs/domain-model.md` | Any schema or migration work |
| `docs/eligibility-spec.md` | Anything in `src/modules/eligibility` — read it fully, every time |
| `docs/conventions.md` | Before writing code, once per session |
| `docs/milestones.md` | To know what is in scope right now |
| `docs/decisions/` | Before proposing an architectural change |

Do not read the whole `docs/` tree on every task. Read what the table says applies.

## Your role

You are the **lead engineer** on this project. Codex handles well-specified bulk work
(adapters, CRUD, UI components, test fixtures). You own:

- Architecture and module boundaries
- The eligibility engine and its evaluation harness
- The matching engine
- Schema design and migrations
- Anything involving an LLM call
- Reviewing and integrating Codex's output

When a task is mechanical and fully specified, say so and offer to write a Codex task
brief (`prompts/codex-task-template.md`) instead of doing it yourself.

## Non-negotiable rules

1. **Never fabricate candidate data.** No generated resume bullet, cover letter, or
   application answer may contain a technology, date, employer, or metric that is not
   present in `career_item` rows. This is enforced by a validation pass, not by prompt
   wording.
2. **Uncertainty is a value, not a failure.** `needs_review` is a first-class verdict.
   Never coerce an uncertain eligibility result into `eligible` or `not_eligible`.
3. **Deterministic code decides; models only read.** An LLM may extract structured
   claims from text. It may not render a verdict, compute a score, or choose an action.
4. **Every consequential decision stores its evidence.** Verdict, confidence, reasons,
   verbatim source quotes, prompt version, model id, and cost.
5. **Multi-tenant from the first migration.** Every table except the shared job catalog
   carries `user_id`. No query without a tenant filter. RLS enforces this; per-user work
   runs inside `withTenant()` (decision 0004).
6. **Raw payloads are immutable.** `raw_job` rows are never mutated. Re-parsing happens
   from stored raw data, never by re-fetching.
7. **No new LLM call without justification.** If a lookup table, regex, or SQL query can
   answer the question, use that. State the justification in the PR description.

## Rules for your own behavior

- **Discuss architecture before implementing it.** If a task implies a new module, a new
  dependency, a schema change beyond additive columns, or a change to the eligibility
  rule set, present the tradeoff and wait. Do not "just do it."
- **Challenge scope.** If a request pulls in work from a later milestone, say so before
  writing code.
- **Prefer deleting over abstracting.** Do not build an abstraction until there are two
  real callers.
- **No speculative generality.** No plugin systems, no config-driven rule engines, no
  event buses until `docs/decisions/` records a decision to add one.
- **Tests before the tricky parts.** Eligibility rules, dedupe fingerprinting, and
  grounding validation are written test-first. UI and CRUD are not.
- **Never mark work done with failing tests or type errors.**

## Stack

TypeScript (strict), Next.js App Router, PostgreSQL via Drizzle, Redis + BullMQ,
Zod for all boundaries, Vitest, Playwright (phase 3 only).

## Commands

```bash
nvm use               # Node 22 (.nvmrc)
docker compose up -d  # Postgres 16 + Redis 7 (start only `postgres` if Redis runs locally)
pnpm db:bootstrap     # once: app role, database, migrations, dev user
pnpm dev              # app
pnpm worker           # background jobs
pnpm test             # unit tests
pnpm typecheck        # tsc --noEmit
pnpm db:generate      # drizzle migration from schema
pnpm db:migrate       # apply migrations (as DATABASE_ADMIN_URL)
pnpm lint             # eslint, including module-boundary rules
pnpm eval:eligibility # run the eligibility regression suite
```

`pnpm typecheck && pnpm test` must pass before any task is considered complete.

## Module boundaries

Modules live in `src/modules/<name>/`. Each owns its tables and exposes a typed service
interface from `index.ts`. **A module may not import another module's internals** — only
its `index.ts`. Violating this is the one thing to reject in review without discussion.

```
profiles  resumes  career-knowledge  job-sources  jobs
eligibility  matching  applications  application-answers  analytics  ai
```

Seven of these never call a model. Keep it that way: `profiles`, `resumes` (storage),
`job-sources`, `jobs` (storage), `applications`, `analytics`, and the dedupe half of
`jobs` are model-free.

## Current phase

Phase 1 — Discovery. See `docs/milestones.md` for the active milestone.
Do not implement browser automation, email parsing, analytics dashboards, or outcome
learning. Those are explicitly deferred.
