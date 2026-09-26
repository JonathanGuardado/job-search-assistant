# Job Seeker Assistant — build kit

Everything needed to start implementing with Claude Code (lead) and Codex (bulk work).

## Setup

```bash
mkdir job-seeker-assistant && cd job-seeker-assistant
# copy this kit's contents in, then:
mv scaffold/* scaffold/.env.example . && rmdir scaffold
git init && pnpm install
pnpm typecheck && pnpm test
```

Then open Claude Code in that directory and paste `prompts/00-bootstrap.md`.

## Running locally

```bash
nvm use                      # Node 22
cp .env.example .env.local   # choose DeepSeek or Gemini; add its API key for model calls
docker compose -p job-seeker-assistant up -d # add `postgres` if Redis already runs locally
pnpm db:bootstrap            # app role, database, migrations, dev user (safe to re-run)
pnpm typecheck && pnpm test && pnpm lint
pnpm dev                     # http://localhost:3000/health
pnpm worker                  # background jobs
```

Tests use real Postgres and Redis (`.env.test`). The test database is created and
migrated automatically.

Local databases are `job_seeker` and `job_seeker_test`, with the runtime role
`job_seeker_app`. Pass `-p job-seeker-assistant` to Compose commands to keep the
project name independent of the checkout directory. The volume key is
`job-seeker-pg`. Historical
migrations retain the original role name; a later migration transfers runtime
permissions to the current role (see [decision 0005](docs/decisions/0005-project-storage-names.md)).

Model calls support DeepSeek and Gemini through the same validated `callModel`
interface. Configure `AI_PROVIDER`, `MODEL_EXTRACTION`, and `MODEL_REASONING` in
`.env.local`, and set `AI_API_KEY` to that provider's credential. See
[AI provider setup](docs/ai-providers.md) for examples, new model configuration,
pricing estimates, and the optional live smoke check.

## What is here

| Path | What it is |
| --- | --- |
| `CLAUDE.md` | Claude Code's context — role, rules, module boundaries |
| `AGENTS.md` | Codex's context — narrower role, same hard rules |
| `docs/architecture.md` | Modular monolith, module map, LLM boundary |
| `docs/domain-model.md` | Authoritative schema reference |
| `docs/eligibility-spec.md` | The core engine's full specification |
| `docs/conventions.md` | Coding standards both agents follow |
| `docs/milestones.md` | Phase 1 broken into nine shippable milestones |
| `docs/decisions/` | Decision records, with the reasoning |
| `.claude/commands/` | `/milestone`, `/codex-brief`, `/review`, `/eval`, `/adapter` |
| `.claude/settings.json` | Permission allowlist so Claude Code isn't asking constantly |
| `prompts/00-09` | Copy-paste kickoff prompt per milestone |
| `prompts/codex-task-template.md` | The handoff format for Codex work |
| `scaffold/` | Runnable starting code — move to the repo root |

## How the two agents split work

Claude Code leads: architecture, schema, the eligibility and matching engines, anything
touching a model, and reviewing Codex's output. It reads `CLAUDE.md`.

Codex implements well-specified work: adapters, CRUD, UI, migrations from an agreed
schema. It reads `AGENTS.md`, which tells it to stop and report rather than make
architectural decisions.

`docs/milestones.md` assigns each milestone an owner. Before handing one to Codex, run
`/codex-brief` in Claude Code to generate a self-contained task brief — Codex should never
need this conversation's context.

## What is already built in `scaffold/`

**Complete and verified** (typechecks under strict mode, 16 passing tests):

- `src/modules/eligibility/` — the full three-stage engine: claim types with Zod schemas,
  the seven rules as pure functions, region and timezone arithmetic, quote validation
  against source text, confidence by stage, and the orchestrator. Tests cover the third
  state, the US-only trap, region membership, preferences-never-reject, and quote
  stripping.
- `src/modules/job-sources/adapter.ts` — the `JobSourceAdapter` interface and
  `NormalizedJob` schema.
- `src/lib/result.ts` — the `Result` type domain code returns instead of throwing.
- `package.json`, `tsconfig.json`, `.env.example`.

**Not yet written** — milestone 1.1 builds these, and `prompts/01-foundation.md` says so:

- The Drizzle schema files and migration setup
- `src/modules/ai/` — `callModel`, provider abstraction, trace logging
- The eligibility extraction prompt and its `extract` implementation
- `evals/run-eligibility-eval.ts` and the labeled dataset
- The Greenhouse adapter implementation
- BullMQ setup, the worker entrypoint, and any UI

This split is deliberate. The eligibility engine is the piece worth handing you working
rather than describing, because it is where the product's value sits and where an agent
building from scratch is most likely to quietly get it wrong. The rest is ordinary work
that Claude Code and Codex will do well from the specs.

## Suggested first week

1. Bootstrap (`prompts/00-bootstrap.md`) — half a day
2. Milestone 1.1 foundation (`prompts/01-foundation.md`) — discuss tenancy enforcement
   before writing code
3. Milestone 1.4 adapters via Codex, in parallel with 1.2 profile
4. Label 60 real postings in `evals/dataset.jsonl` by hand before starting 1.6

That last one matters more than it sounds. Labeling before implementing is what stops the
engine from being built to match its own output.
