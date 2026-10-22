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
| `failed`), `attempt_id`, `lease_expires_at`, `result` (jsonb, shaped by the task),
`traces` (jsonb, every attempt), `model`, `cost_micro_usd`, `error_code`,
`error_message`, `started_at`, `completed_at`.

Unique on `(resume_id, task, task_version)`. A retry resumes the same row, and traces and
cost accumulate across attempts. An improved prompt version is a new row, which is how a
resume is re-parsed without touching the original run.

- **Ownership is leased** (decision 0007). Each claim writes a new `attempt_id` and a
  `lease_expires_at` that the worker renews. Only that attempt can complete or fail the
  run. A CHECK keeps `lease_expires_at` set exactly while `running`.
- A `running` row whose lease has expired is *stalled*: its worker died. It can be
  reclaimed by a retry or deleted with its resume.

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
Owned by `job-sources`. `id`, `adapter_key` (`greenhouse` | `lever`), `name`, `config`
(jsonb, `{ token }`: the Greenhouse board token or Lever site name), `enabled`, `cursor`,
`last_polled_at`, `health_status` (`unknown` | `ok` | `failing`), `health_message`,
`health_checked_at`, `created_at`.

- Unique on `(adapter_key, config->>'token')`: a board is registered once.
- `name` is the company name given to every job from the source. Boards label themselves
  inconsistently in their payloads (one calls itself "Stone - Linkedin").
- `cursor` is the next page of a poll in progress, null between polls. `last_polled_at`
  is set when a poll fetches its final page.

### `raw_jobs`
Owned by `job-sources`. Verbatim capture. **Never mutated.** Re-parsing replays from here.
The app role has no UPDATE or DELETE privilege on this table.

`id`, `source_id`, `external_id`, `payload` (jsonb), `content_hash`, `fetched_at`.
Unique on `(source_id, external_id, content_hash)` so an unchanged repoll is a no-op and
a changed posting creates a new row. `content_hash` is the sha256 of the payload's
canonical JSON (keys sorted), so key order in the source's response does not matter.

### `jobs`
Owned by `jobs`. Canonical, deduplicated: one row per posting, keyed `(source_id,
external_id)` and normalized from the newest raw version of that posting.

`id`, `source_id`, `external_id`, `raw_job_id` (the version normalized from),
`raw_fetched_at`, `company_name`, `company_normalized`, `title` (verbatim),
`title_normalized`, `seniority` (`intern` | `junior` | `senior` | `lead` | `staff` |
`principal`, nullable), `description`, `location_policy` (`onsite` | `hybrid` | `remote`
| `unknown`), `location_text`, `location_country` (ISO alpha-2, structured sources only),
`remote_scope` (jsonb, nullable, unused until 1.6), `employment_type`,
`salary_min_minor`, `salary_max_minor`, `salary_currency`, `salary_source` (`posted` |
`unknown`), `apply_url` (http(s) only), `posted_at`, `fingerprint`, `canonical_job_id`
(self-ref for duplicates), `first_seen_at`, `last_seen_at`, `closed_at`.

- **Replayable.** Normalization is a pure function of the raw version, so `pnpm
  jobs:renormalize` rebuilds every row. An upsert never replaces a newer version with an
  older one (`raw_fetched_at`).
- **Open while listed.** Each poll page updates `last_seen_at` for what it lists. After a
  poll's last page, the source's jobs it did not list are closed. A job that reappears is
  reopened. A poll that listed none of the source's jobs closes nothing.

A field that cannot be parsed confidently is **null plus a flag**, never guessed.
`salary_source = 'unknown'` is different from a salary of zero. `jobs_salary_check`
enforces this in the database: an unknown salary carries no numbers, and a posted one
carries a currency and at least one bound. Salary columns are `bigint`, because minor
units of weak currencies overflow 32 bits.

### `job_posting_snapshots`
`id`, `job_id`, `full_text`, `captured_at`. Postings disappear; applications must not.

### `job_eligibility_claims`
Owned by `eligibility`. Shared: what a posting states, extracted once per text version and
reused for every candidate (decision 0009). It holds no candidate data.

`id`, `job_id`, `task_version`, `job_fingerprint` (the text it was read from), `claims`
(jsonb, as the model returned them; quotes are re-validated on every assessment),
`traces` (jsonb), `model`, `cost_micro_usd`, `extracted_at`. Unique on
`(job_id, task_version)`.

### `eligibility_assessments`
Owned by `eligibility`. `id`, `user_id`, `job_id`, `engine_version`, `verdict`
(`eligible` | `not_eligible` | `needs_review`), `confidence` (0–1), `stage`
(`structured` | `extracted` | `partial`), `reasons` (jsonb: the deciding rule and its
text, or the open questions), `evidence` (jsonb: rule id + verbatim quote), `claims_id`
(null when structured fields decided), `prompt_version`, `model`, `job_fingerprint` and
`profile_hash` (the inputs, to detect staleness), `assessed_at`, `user_override`
(nullable), `override_reason`.

Unique on `(user_id, job_id, engine_version)`. Keeping old versions is what lets you
re-run an improved engine and diff it against the previous one. Re-assessment replaces
the engine's verdict and never the user's override.

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

A duplicate is the same posting listed twice (decision 0008), not the same role in
another location.

Fingerprint = hash of `(company_normalized, title_normalized, seniority, location_policy,
location_key, description words)`, where the description is compared after case,
punctuation, whitespace and identifiers of 5+ digits are ignored. An equal fingerprint is
a duplicate; there is no similarity threshold. Duplicates are linked through
`canonical_job_id` to the earliest-seen open member, never deleted. The UI can then show
"also posted on Lever".

Company normalization strips legal suffixes (only at the end), punctuation, accents, and
case. Title normalization drops board decorations made only of work-arrangement and
region words (`(Remote - LATAM)`, `| Remote |`, `(Contract)`) and reads seniority from
leading words into its own column. Level numerals (`II`) stay in the title, because they
name different jobs.

## Migration discipline

Additive columns and new tables are safe. Renames, drops, and type changes need a
decision record and a two-step migration (add, backfill, switch reads, drop later).
