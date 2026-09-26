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

`constraint_modes` is what makes the hard/soft split configurable per user rather than
hardcoded. A field marked `hard` can produce `not_eligible`; a field marked `preferred`
can only lower a match dimension.

### `resumes`
Immutable versions. `is_master` marks the base; tailored versions reference `parent_id`.

`id`, `user_id`, `version`, `parent_id`, `is_master`, `storage_key`, `filename`,
`parsed_payload` (jsonb), `parse_status`, `parse_reviewed_at`, `created_at`.

Never edit in place. A tailored resume is a new row.

### `career_items`
The grounding source for every piece of generated text. If a claim is not here, it may
not appear in a cover letter or application answer.

`id`, `user_id`, `type` (`role` | `project` | `education` | `achievement` | `story`),
`organization`, `title`, `started_at`, `ended_at`, `summary`, `achievements` (text[]),
`technologies` (text[]), `metrics` (jsonb), `source_resume_id`, `verified_by_user`.

`verified_by_user` matters: parsed items start false and are confirmed in the review
step. Unverified items may be used for matching but not for generation.

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
