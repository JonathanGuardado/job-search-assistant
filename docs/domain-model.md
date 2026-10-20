# Domain model

Authoritative reference for the schema. The Drizzle definitions in
`src/modules/*/schema.ts` must match this document; if they diverge, fix one of them
deliberately rather than letting the drift stand.

## Tenancy

Every table carries `user_id` **except** the shared job catalog: `job_sources`,
`raw_jobs`, `jobs`, `job_posting_snapshots`. A Greenhouse posting is the same posting for
everyone, so it is stored once and assessed per candidate. This keeps scraping work
shared and per-user tables small.

Consequence: assessments are the per-user layer. `eligibility_assessments` and
`match_assessments` are keyed `(user_id, job_id)`.

**Enforcement.** Row-level security enforces tenancy, not query discipline (decision
0004). Every per-user table enables RLS and declares exactly one policy,
`tenant_isolation`. The app queries per-user tables inside `withTenant()`.
`src/lib/db/schema-invariants.test.ts` fails if a table with `user_id` is missing the
policy, or if a table without `user_id` isn't on the shared list.

## Tables

### `users`
Owned by `profiles`. The tenant list: `id`, `email` (unique), `created_at`. It isn't
RLS-protected, since it holds no candidate data and fan-out jobs read it to enqueue one
tenant-scoped job per user. Until auth exists, it holds one seeded dev user.

### `candidate_profiles`
One per user. The constraint set that drives every decision.

| Column | Type | Notes |
| --- | --- | --- |
| `id`, `user_id` | uuid | |
| `country`, `city`, `timezone` | text | IANA timezone |
| `work_authorizations` | jsonb | `[{ country, type, expiresAt? }]` |
| `willing_to_relocate` | boolean | |
| `allowed_regions` | text[] | `worldwide`, `latam`, `emea`, ISO country codes |
| `employment_types` | text[] | `employee`, `contractor`, `eor` |
| `salary_floor_minor`, `salary_currency` | integer, text | Integer minor units |
| `target_roles`, `seniority` | text[], text | |
| `preferred_tech`, `excluded_tech` | text[] | |
| `excluded_companies`, `excluded_industries` | text[] | |
| `constraint_modes` | jsonb | Maps each field above to `hard` or `preferred` |

The profile is unique per `user_id`, protected by RLS, and configured at `/settings`.
All constraint keys use the camelCase service field names. Work authorization and
relocation willingness are always `hard`, enforced by the Zod type and a database CHECK.
Other fields independently accept `hard` or `preferred`. An unstated salary floor is
null; amounts use the selected currency’s minor units. This table follows the specified
Postgres integer salary column, so values above 2,147,483,647 minor units are rejected.
No salary period or automatic currency conversion is inferred.

`constraint_modes` is what makes the hard/soft split configurable per user rather than
hardcoded. A field marked `hard` can produce `not_eligible`; a field marked `preferred`
can only lower a match dimension.

### `resumes`
Owned by `resumes`. Immutable versions: the app role has no UPDATE privilege on this
table, so an edit in place is refused by the database.

`id`, `user_id`, `version` (unique per user), `parent_id`, `is_master`, `storage_key`,
`filename`, `content_type` (PDF or DOCX, detected from the bytes), `byte_size` (≤ 5 MB),
`content_sha256`, `extracted_text`, `text_extractor`, `created_at`.

- `is_master` is set at insert and never flipped. Every upload is a master; the current
  resume is the highest version. Tailored versions (phase 2) have `is_master = false` and
  reference `parent_id`, and a CHECK keeps the two consistent.
- `extracted_text` is stored here because it is a pure function of the file. Every quote
  a model returns is validated against it.
- `storage_key` is `resumes/<user_id>/<sha256>`: content-addressed, never overwritten
  (decision 0006).
- Users may delete a version after parsing finishes. Deletion removes its parse history
  and unconfirmed career items, but preserves confirmed items and their original evidence.
  Their source references become null. A master with derived versions cannot be deleted.
  Stored files are removed after commit only when no remaining version uses them.

### `resume_parses`
Owned by `resumes`. One run of a parse task over one version, and the audit record of
the model call. It replaces the `parsed_payload` / `parse_status` / `parse_reviewed_at`
columns once planned for `resumes`, which kept a mutable status on an immutable row.

`id`, `user_id`, `resume_id`, `task`, `task_version`, `status` (`running` | `succeeded`
| `failed`), `result` (jsonb, shaped by the task), `traces` (jsonb, every attempt),
`model`, `cost_micro_usd`, `error_code`, `error_message`, `started_at`, `completed_at`.

Unique on `(resume_id, task, task_version)`. A retry resumes the same row, and traces and
cost accumulate across attempts. An improved prompt version is a new row, which is how a
resume is re-parsed without touching the original run.

### `career_items`
The grounding source for every piece of generated text. If a claim is not here, it may
not appear in a cover letter or application answer.

Owned by `career-knowledge`.

`id`, `user_id`, `type` (`role` | `project` | `education` | `achievement` | `story`),
`organization`, `title`, `started_on`, `ended_on`, `is_current`, `summary`,
`achievements` (text[]), `technologies` (text[]), `metrics` (jsonb, not extracted yet),
`evidence` (jsonb), `source_resume_id`, `source_parse_id`, `verified_by_user`,
`verified_at`, `created_at`, `updated_at`.

- **Dates are partial.** `started_on` and `ended_on` are `YYYY` or `YYYY-MM` text, not
  timestamps: a resume that says "2020" must not become 2020-01-01. `is_current` records
  "Present", and CHECKs forbid an end date on a current entry.
- **`evidence`** holds the parse-time source spans (quote plus offsets into
  `resumes.extracted_text`) for each value. User corrections don't rewrite it.
- **`verified_by_user`** matters: parsed items start false and are confirmed in the review
  step. Unverified items may be used for matching but not for generation. The service
  enforces this with `listGroundingItems()`, which returns `VerifiedCareerItem`, and a
  CHECK ties `verified_by_user` to `verified_at`.

### `job_sources`
`id`, `adapter_key` (`greenhouse` | `lever` | `ashby` | ...), `config` (jsonb, e.g. board
token), `cursor`, `last_polled_at`, `health_status`, `enabled`.

### `raw_jobs`
Verbatim capture. **Never mutated.** Re-parsing replays from here.

`id`, `source_id`, `external_id`, `payload` (jsonb), `content_hash`, `fetched_at`.
Unique on `(source_id, external_id, content_hash)` so an unchanged repoll is a no-op and
a changed posting creates a new row.

### `jobs`
Canonical, deduplicated.

`id`, `company_name`, `company_normalized`, `title`, `title_normalized`, `description`,
`location_policy` (`onsite` | `hybrid` | `remote` | `unknown`), `location_text`,
`remote_scope` (jsonb, nullable), `employment_type`, `salary_min_minor`,
`salary_max_minor`, `salary_currency`, `salary_source` (`posted` | `unknown`),
`apply_url`, `fingerprint`, `canonical_job_id` (self-ref for duplicates),
`first_seen_at`, `last_seen_at`, `closed_at`.

A field that cannot be parsed confidently is **null plus a flag**, never guessed.
`salary_source = 'unknown'` is different from a salary of zero. `jobs_salary_check`
enforces this in the database: an unknown salary carries no numbers, and a posted one
carries a currency and at least one bound. Salary columns are `bigint`, because minor
units of weak currencies overflow 32 bits.

### `job_posting_snapshots`
`id`, `job_id`, `full_text`, `captured_at`. Postings disappear; applications must not.

### `eligibility_assessments`
`id`, `user_id`, `job_id`, `verdict` (`eligible` | `not_eligible` | `needs_review`),
`confidence` (0–1), `reasons` (jsonb: rule ids + human text), `evidence` (jsonb:
verbatim quotes with offsets), `extracted_claims` (jsonb), `engine_version`,
`prompt_version`, `model`, `assessed_at`, `user_override` (nullable),
`override_reason`.

Unique on `(user_id, job_id, engine_version)`. Keeping old versions is what lets you
re-run an improved engine and diff it against the previous one.

### `match_assessments`
`id`, `user_id`, `job_id`, `dimensions` (jsonb: per-dimension verdict + evidence),
`met_requirements`, `missing_requirements`, `concerns` (text[]),
`salary_compatibility` (`above` | `within` | `below` | `unknown`), `engine_version`,
`assessed_at`.

No single overall score column. If the UI needs an ordering, it derives one at query time
from the dimensions, and the derivation is visible in the UI.

### `applications`
`id`, `user_id`, `job_id`, `status`, `mode` (`manual` | `approval` | `automatic`),
`resume_id`, `cover_letter`, `answers` (jsonb), `salary_submitted_minor`,
`applied_at`, `source_url`, `snapshot_id`, `contact` (jsonb), `notes`,
`outcome_reason`, `created_at`.

`resume_id` points at the exact immutable version submitted.

### `application_events`
Append-only. `id`, `application_id`, `from_status`, `to_status`, `actor`
(`user` | `system`), `note`, `occurred_at`.

Time-in-stage and conversion rates come from this log. Never overwrite `status` without
writing the event.

### `job_user_states`
Owned by `jobs`. `id`, `user_id`, `job_id`, `state` (`new` | `saved` | `ignored` |
`applied`), `updated_at`. Unique on `(user_id, job_id)`. Keeps user actions off the
shared `jobs` table.

## Deduplication

Fingerprint = hash of `(company_normalized, title_normalized, location_policy,
remote_scope_key)`. On collision, compare description similarity; above threshold, link
via `canonical_job_id` rather than deleting. The UI can then show "also posted on Lever".

Company normalization strips legal suffixes, punctuation, and case. Title normalization
strips seniority decorations that vary by board (`(Remote)`, `- LATAM`, roman numerals)
into a separate parsed field.

## Migration discipline

Additive columns and new tables are safe. Renames, drops, and type changes need a
decision record and a two-step migration (add, backfill, switch reads, drop later).
