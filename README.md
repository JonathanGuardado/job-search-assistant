# Job Seeker Assistant

A job search assistant built around evidence-backed eligibility decisions. The current
application provides a resume library: PDF/DOCX upload, immutable versions, background
extraction, source-linked review, corrections, confirmation, and deletion that preserves
confirmed career items. Job discovery, matching, and application tracking are not wired
up yet. See [milestones](docs/milestones.md).

## Local setup

Requires Node 22+, pnpm, Docker, and a Gemini or DeepSeek API key for resume parsing.

```bash
pnpm install
cp .env.example .env.local
# Fill in AI_API_KEY in .env.local. The example selects Gemini.
docker compose -p job-seeker-assistant up -d
pnpm db:bootstrap
pnpm dev
```

In a separate terminal, start the background worker:

```bash
pnpm worker
```

Open http://localhost:3000/resumes. Both processes must share the same database, Redis,
and `STORAGE_DIR`. Restart them after changing `.env.local`. Authentication is not yet
implemented; local pages use a seeded development user.

Resume files are stored locally in `.data/storage` by default, outside Git. This storage
supports one host only; include it in backups. See [decision 0006](docs/decisions/0006-resume-file-storage.md).
Provider settings and the optional live smoke check are documented in
[AI provider setup](docs/ai-providers.md).

## Verification

```bash
pnpm typecheck && pnpm test && pnpm lint
```

Tests use real PostgreSQL and Redis with `.env.test`; the test database is created and
migrated automatically. Tests stub model calls. `pnpm build` checks the production build.
The `eval:eligibility` command is reserved for milestone 1.6; its runner and labeled
dataset are not implemented yet.

The local databases are `job_seeker` and `job_seeker_test`; the runtime role is
`job_seeker_app`. Compose uses project `job-seeker-assistant` and volume key
`job-seeker-pg` ([decision 0005](docs/decisions/0005-project-storage-names.md)).

## Project references

- [Architecture](docs/architecture.md), [domain model](docs/domain-model.md), and [conventions](docs/conventions.md)
- [Eligibility specification](docs/eligibility-spec.md)
- [Task briefs](prompts/) and [milestones](docs/milestones.md)
- [Coding-agent instructions](AGENTS.md) and [lead-agent instructions](CLAUDE.md)
