# Prompt 00 — Bootstrap the repository

**Run in:** Claude Code, in an empty directory with the kit's files already copied in.

---

Set up this repository. The context files are already in place — read `CLAUDE.md`,
`docs/architecture.md`, `docs/conventions.md`, and `docs/domain-model.md` before you
start.

The `scaffold/` directory contains a starting point: config files, the db layer, module
skeletons, the eligibility types and rule engine, and an eval harness stub. Move its
contents to the repository root and delete the now-empty `scaffold/` directory.

Then:

1. `git init`, and write a `.gitignore` covering `node_modules`, `.next`, `.env*`
   (keeping `.env.example`), `dist`, and `coverage`.
2. `pnpm install`, then verify `pnpm typecheck` and `pnpm test` both pass. Fix anything
   that does not — the scaffold is a starting point, not gospel.
3. Bring up Postgres and Redis with a `docker-compose.yml` for local development.
4. Confirm `pnpm db:generate` produces a migration from the existing schema files.
5. Commit as "Initial scaffold from build kit".

Then report:

- What in the scaffold you had to change, and why
- Anything in the scaffold that contradicts the docs
- What the next milestone (1.1 in `docs/milestones.md`) actually requires beyond what is
  already here

Do not start milestone 1.1 in this session. Bootstrap only.
