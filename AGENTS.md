# AGENTS.md — Job Seeker Assistant

Instructions for coding agents working in this repository. Codex reads this file.
Claude Code reads `CLAUDE.md` (which is stricter and assigns it the lead role).

## What this project is

A multi-user job search assistant. Its core differentiator is an **eligibility engine**
that decides whether a specific candidate can actually take a specific "remote" job —
accounting for country restrictions, work authorization, time zones, contractor vs
employee arrangements, and relocation — and shows the evidence behind every verdict.

## Your role

You implement **well-specified work**: source adapters, CRUD services, React components,
migrations from an agreed schema, test fixtures, and refactors with a stated target.

You do **not** make architectural decisions. If a task requires one — a new dependency,
a new module, a schema change not described in the task, a change to eligibility rules,
or a new LLM call — **stop and report what decision is needed** rather than choosing.

Tasks arrive as briefs in `prompts/` or written from `prompts/codex-task-template.md`.
A brief names its scope, its files, and its definition of done. Stay inside that scope.

## Read before implementing

- `docs/conventions.md` — coding standards (read once per session)
- `docs/domain-model.md` — before any schema or query work
- `docs/architecture.md` — before any work crossing module boundaries
- `docs/eligibility-spec.md` — before touching `src/modules/eligibility`

## Hard rules

1. **Never invent candidate data.** Generated text may only restate facts that exist in
   the database. No invented technologies, dates, employers, or metrics.
2. **Never remove the `needs_review` path.** Uncertain eligibility stays uncertain.
3. **LLMs extract; code decides.** A model call may return structured data. It may not
   produce a verdict, a score, or a decision to act.
4. **Every table except the job catalog carries `user_id`**, enforced by Postgres RLS:
   per-user queries run inside `withTenant()`, and a new per-user table declares
   `tenantIsolation()` (see `docs/decisions/0004-tenancy-rls.md`). No query without a tenant
   filter. No exceptions, even in scripts.
5. **Never mutate `raw_job` rows.** They are the replay log.
6. **Modules import only other modules' `index.ts`.** Never reach into internals.
7. **No new npm dependency without it being named in the task brief.**

## Stack and commands

TypeScript strict, Next.js App Router, PostgreSQL + Drizzle, Redis + BullMQ, Zod, Vitest.

```bash
pnpm typecheck        # must pass
pnpm test             # must pass
pnpm lint             # must pass
pnpm db:generate      # generate migration after editing schema
pnpm eval:eligibility # eligibility regression suite
```

Run `pnpm typecheck && pnpm test && pnpm lint` before reporting a task complete.
If any fail and you cannot fix them within the task's scope, report the failure — do not
work around it by loosening types, skipping tests, or adding `any`.

## Code expectations

- No `any`. No non-null assertions (`!`) outside tests. No `as` casts except at parsed
  external boundaries, and only immediately after Zod validation.
- Every external input (HTTP response, LLM output, form body, env var) is parsed with Zod
  at the boundary. Types are inferred from the schema, never hand-written alongside it.
- Errors are returned as typed results in domain code, thrown only at the edges.
- Functions do one thing. A function over ~50 lines needs a reason.
- Tests cover behavior and edge cases, not line count. Eligibility rules, dedupe, and
  grounding validation are written test-first.
- Comments explain *why*, never *what*. Delete a comment that restates the code.

## Reporting back

When a task is done, report: what changed (file list), what you decided that the brief
did not specify, what you could not do and why, and the output of the verification
commands. Do not report success with failing checks.
