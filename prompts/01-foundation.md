# Milestone 1.1 — Foundation

**Owner:** Claude Code
**Done when:** a job row writes and reads through a module interface, and typecheck,
tests, lint, and migrations all run cleanly.

---

Implement milestone 1.1. Read `docs/architecture.md` and `docs/domain-model.md` first,
then plan before writing code.

What this milestone establishes:

1. **The module pattern, demonstrated once properly.** Take `jobs` as the reference
   module: `index.ts` exporting a typed service, `schema.ts` owning its tables,
   `types.ts` with Zod schemas, `service.ts` with the logic. Every later module copies
   this shape, so get it right.
2. **The database layer.** Drizzle client, connection pooling, migration workflow, and a
   test harness that runs against a real Postgres instance (not a mock) with per-test
   transaction rollback.
3. **The queue.** BullMQ setup with one trivial job proving the worker runs, retries, and
   is idempotent. A separate `pnpm worker` entrypoint.
4. **Tenancy enforcement.** A mechanism that makes it hard to write a query against a
   per-user table without a tenant filter. Propose an approach — a repository wrapper, a
   lint rule, or a typed query builder — and discuss the tradeoff before implementing.
5. **The `ai` module's shape only.** `callModel({ task, schema, input })` with provider
   selection, Zod validation, retry-once-on-validation-failure, and trace logging. Wire
   one real provider. Do not implement any actual task yet.

Deliberately not in this milestone: any UI beyond a health check page, any real adapter,
any eligibility or matching logic, any auth beyond a hardcoded dev user.

Before you write code, tell me your plan for item 4 specifically. Tenancy enforcement is
the decision here that is expensive to change later.
