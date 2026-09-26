# Milestone 1.4 — Greenhouse and Lever adapters

**Owner:** Codex (brief written by Claude Code)
**Done when:** 500+ real jobs are ingested on a schedule, with adapter tests running
against committed fixtures.

---

Implement the first two job source adapters and the polling infrastructure.

The `JobSourceAdapter` interface is in `src/modules/job-sources/adapter.ts`. Implement
against it; do not modify it without reporting why.

**Scope**

- `adapters/greenhouse.ts` and `adapters/lever.ts`
- `registry.ts` mapping adapter keys to implementations
- The `source-poll` BullMQ job: one page, one source, cursor-based, retryable
- Raw capture into `raw_jobs` with content hashing so an unchanged repoll is a no-op
- A minimal admin page to add a source (adapter key + board token) and see its health

**Normalization rules — not negotiable**

- A field that cannot be parsed confidently is null plus its `*_source: 'unknown'` flag.
  Never guess a salary, a location policy, or an employment type. A wrong value here
  silently poisons every downstream decision.
- Board-specific title decorations (`(Remote)`, `- LATAM`, `Senior II`) are stripped into
  parsed fields rather than left in `title_normalized`.
- The full description text is preserved verbatim. The eligibility engine reads it.
- Salary strings are parsed conservatively: a range parses, "competitive" does not, and
  "$120k+" parses as a minimum with no maximum.

**Seeding company boards**

The open question is which boards to poll. For this milestone, support manual entry of a
board token and seed 20–30 companies known to hire remotely in LATAM. Do not build a
crawler.

**Tests** against committed fixtures in `__fixtures__/`: happy path, malformed payload,
missing salary, unclassifiable location, and a repoll producing no new raw row.

No eligibility, matching, dedupe, or filtering logic in this milestone.
