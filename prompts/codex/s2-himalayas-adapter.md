## Task: Read Himalayas, a job board, as a fourth source

**Milestone:** S.2 (sources track, alongside phase 2)
**Read first:** `AGENTS.md`, `docs/conventions.md`, `docs/architecture.md` (module boundaries), `docs/decisions/0017-job-board-country-lists.md` (every decision this brief relies on), and the Ashby adapter with its tests: `src/modules/job-sources/adapters/ashby.ts`, `ashby.test.ts`.

### Before you start

This brief builds on work that must already be committed. Run:

```bash
test -f drizzle/0021_remote-countries.sql \
  && test -f src/modules/job-sources/__fixtures__/himalayas-search.json \
  && test -f src/modules/job-sources/country-names.ts \
  && grep -q "remoteCountries" src/modules/job-sources/adapter.ts \
  && grep -q "ENGINE_VERSION = 6" src/modules/eligibility/types.ts \
  && test -z "$(git status --porcelain)" && echo ready
```

If it does not print `ready`, stop and report. Do not recreate any of those files. The last line checks that the working tree is clean: the prerequisites must be committed, not just present, so that your changes can be reviewed apart from them.

### Goal

Every source so far is one company's own board. Himalayas (himalayas.app) is a job board that lists remote jobs from many companies, and its API can be asked for the jobs open to one country. After this task the system polls Himalayas once a day for a country, stores each posting verbatim, and normalizes it like any other posting, with the board's list of countries in `remoteCountries`, where the eligibility engine already reads it (engine v6). A posting from a company the owner already follows on Greenhouse, Lever or Ashby is left out, because the company's own board has the same job. Every Himalayas job shows a "via Himalayas" credit.

Himalayas' API terms were checked on 2026-11-12. They allow this use on four conditions, and three of them are requirements of this task:

1. The apply link is the posting's `applicationLink`, unchanged. Never build or substitute another link.
2. A visible credit links to `https://himalayas.app` wherever a Himalayas job is shown.
3. The data is not passed on to third parties. This repository is public, so **no real Himalayas posting may be committed**: not in fixtures, tests, docs or comments.

### Scope

**In scope**

- New `src/modules/job-sources/adapters/himalayas.ts` and `himalayas.test.ts`.
- `src/modules/job-sources/adapter.ts`: add `'himalayas'` to `ADAPTER_KEYS`; add the two optional fields to `JobSourceAdapter` given under "Interfaces"; extend the `AdapterConfigSchema` comment ("or, for Himalayas, a two-letter country code").
- `src/modules/job-sources/registry.ts`: register the adapter.
- `src/modules/job-sources/test-fixtures.ts`: export `himalayasFixture`, parsed like the others.
- `src/modules/job-sources/service.ts`, `index.ts`, `service.test.ts`: per-adapter poll interval in `dispatchSourcePolls`; new `isCompanyBoard`, `listFollowedCompanyNames`, `listSourceCredits`.
- `src/modules/jobs/service.ts`, `index.ts`, `service.test.ts`: new `withoutFollowedCompanies`.
- `src/worker.ts`: one call, given under "Implementation notes".
- A generated migration, applied (see notes): `pnpm db:generate --name himalayas-adapter`.
- `src/app/jobs/_lib/format.ts` and `format.test.ts`: `formatLocation` takes the job.
- `src/app/jobs/_components/JobRow.tsx`, `src/app/jobs/page.tsx`, `src/app/jobs/[jobId]/page.tsx`: the credit, and the new `formatLocation` call.
- `src/app/sources/page.tsx`: the `Himalayas` label and the two sentences given in the notes.
- `scripts/seed-sources.json`: append `{ "adapterKey": "himalayas", "name": "Himalayas", "token": "SV" }` after the last entry.
- `docs/domain-model.md`, the `job_sources` paragraph: `adapter_key` is `greenhouse` | `lever` | `ashby` | `himalayas`; `config.token` is also "for Himalayas, the two-letter country code the board is asked for"; add "a job board's jobs take their company name from the payload".

**Already in the repo, do not change**

- `src/modules/job-sources/__fixtures__/himalayas-search.json`: six postings written by hand in the exact shape of the API's response (`{ comments, updatedAt, offset, limit, totalCount, jobs: [...] }`). The companies and texts are invented. Only the country names are real.
- `src/modules/job-sources/country-names.ts` (`countryCodeOf`) and its test.
- `NormalizedJob.remoteCountries`, `jobs.remote_countries`, the fingerprint, and everything that reads them.

**Out of scope.** Do not touch these, even if they look wrong:

- `src/modules/eligibility`, `src/modules/matching`, `src/modules/jobs/fingerprint.ts`, `evals/`, `docs/decisions/`, `docs/eligibility-spec.md`.
- An API key, request headers, or any change to `http.ts`.
- The posting's `expiryDate`, `timezoneRestrictions`, `seniority`, `categories`, `excerpt` and salary fields: they stay in the stored payload and are not read.
- Leaving out gig or AI-training platforms. Every company not followed comes through.
- Registering the source: do not run `pnpm sources:seed`, and do not add a Himalayas source with token `SV` to the database in any test or script. The owner adds it after review, because the first poll reads about 3,400 postings.
- The live network. Tests use the committed fixture and stubbed fetchers only.

### Interfaces you implement against

These exist. Do not modify them except where this brief says so. If one is wrong for the task, stop and report it.

`src/modules/job-sources/adapter.ts`:

```ts
export const ADAPTER_KEYS = ['greenhouse', 'lever', 'ashby'] as const   // → add 'himalayas' last

export type NormalizedJob = {
  externalId: string
  companyName: string                 // a job board's jobs: the payload's company name
  title: string                       // verbatim, trimmed
  description: string                 // plain text, deterministic (the eligibility engine quotes it)
  locationPolicy: 'onsite' | 'hybrid' | 'remote' | 'unknown'
  locationText: string | null
  locationCountry: string | null      // ISO 3166-1 alpha-2 from a structured field only
  remoteCountries: string[] | null    // ISO alpha-2 codes, at least one; null when the source lists nothing
  employmentType: 'employee' | 'contractor' | 'eor' | 'unknown'
  salary: { source: 'unknown' } | { source: 'posted'; minMinor: number | null; maxMinor: number | null; currency: string }
  applyUrl: string                    // http(s) only
  postedAt: Date | null
}

export type RawJob = { readonly externalId: string; readonly payload: unknown; readonly fetchedAt: Date }
export type Cursor = string
export type FetchResult = { readonly raw: readonly RawJob[]; readonly next: Cursor | null }
export type SourceHealth = { readonly ok: boolean; readonly checkedAt: Date; readonly message?: string }
export type SourceRef = { readonly name: string; readonly config: { token: string } }   // token matches /^[A-Za-z0-9_-]{1,100}$/
export type Fetcher = typeof fetch

export type JobSourceAdapter = {
  readonly key: AdapterKey
  readonly kind: 'ats' | 'board' | 'aggregator'
  readonly volatileKeys: readonly string[]
  fetchPage(source: SourceRef, cursor: Cursor | null, fetcher: Fetcher): Promise<Result<FetchResult>>
  normalize(raw: RawJob, source: SourceRef): Result<NormalizedJob>      // pure, never throws; a bad payload is invalid_input
  health(source: SourceRef, fetcher: Fetcher): Promise<SourceHealth>    // never throws
  fetchApplicationForm?: …   // not for this adapter
  applicationPages?: …       // not for this adapter
  readApplicationForm?: …    // not for this adapter
}
```

Add exactly these two optional fields to `JobSourceAdapter`, with these comments:

```ts
  /** How often the source is polled, when not the default (POLL_INTERVAL_MS). */
  readonly pollEveryMs?: number
  /** The credit a source's terms require wherever its jobs are shown. */
  readonly credit?: { readonly name: string; readonly url: string }
```

Helpers, all existing:

```ts
// src/modules/job-sources/http.ts — 404 is not_found, other non-2xx and network errors upstream_failed, a body that fails the schema validation_failed
export async function getJson<S extends z.ZodType>(url: string, schema: S, fetcher: Fetcher): Promise<Result<z.output<S>>>
// src/modules/job-sources/html-text.ts
export function htmlToPlainText(html: string): string
// src/modules/job-sources/country-names.ts — an English country name to its ISO alpha-2 code, null when unknown
export function countryCodeOf(name: string): string | null
// src/modules/job-sources/types.ts
export type PagePosting = { readonly externalId: string; readonly rawJobId: string }
// src/modules/job-sources/service.ts
export async function readNormalizedPosting(db: Db, rawJobId: string): Promise<Result<NormalizedPosting>>   // .value.job is the NormalizedJob
// src/modules/jobs/normalize-company.ts
export function normalizeCompany(name: string): string
// src/modules/jobs/service.ts
export async function recordSightings(db: Db, input: { sourceId: string; postings: readonly PagePosting[]; seenAt: Date }): Promise<{ rawJobIdsToNormalize: readonly string[] }>
export async function closeUnseenJobs(db: Db, input: { sourceId: string; pollStartedAt: Date }): Promise<{ closed: number; skipped: boolean }>
```

### Implementation notes

**The API**

- One request: `GET https://himalayas.app/jobs/api/search?country=<TOKEN>&sort=recent&page=<N>`, pages from 1. The response is `{ comments, updatedAt, offset, limit, totalCount, jobs }` with 20 jobs to a full page. `totalCount` is an estimate: do not use it.
- A posting's fields, as the fixture shows them: `title`, `excerpt`, `companyName`, `companySlug`, `companyLogo`, `employmentType` (`"Full Time"`, `"Part Time"`, `"Contractor"`, `"Temporary"`, `"Intern"`), `minSalary`, `maxSalary`, `salaryPeriod`, `seniority`, `currency`, `locationRestrictions` (country names, possibly empty), `timezoneRestrictions`, `categories`, `parentCategories`, `description` (HTML or null), `pubDate` and `expiryDate` (Unix seconds), `applicationLink`, `guid` (`https://himalayas.app/companies/<company>/jobs/<slug>`).

**The adapter** (`himalayasAdapter`)

- `key: 'himalayas'`, `kind: 'board'`, `volatileKeys: []` (the same posting fetched a day apart was byte-identical), `pollEveryMs: 24 * 60 * 60_000`, `credit: { name: 'Himalayas', url: 'https://himalayas.app' }`.
- The token is the country code. Anything not matching `/^[A-Z]{2}$/` is `invalid_input` from `fetchPage` (no request made), and from `health` it is `{ ok: false, message: 'Use a two-letter country code, such as SV.' }`.
- The external id is `<company>/<slug>`, the two captured parts of `guid` matched against `/^https:\/\/himalayas\.app\/companies\/([^/]+)\/jobs\/([^/]+)$/`. The page schema requires every job's `guid` to match, so one malformed guid fails the page as `validation_failed`.
- `fetchPage`:
  - The cursor is the page number as a string; `null` is page 1. A cursor that is not a positive integer is `invalid_input`.
  - A cursor above `500` is `upstream_failed` with the message `Himalayas returned more than 500 pages.`, with no request made. This stops a poll if the API ever ignores `page`.
  - Before every request that has a cursor (page 2 onward), wait `PAGE_PAUSE_MS = 1_500`, with `await new Promise((resolve) => setTimeout(resolve, PAGE_PAUSE_MS))`. Page 1 and `health` do not wait.
  - `next` is the next page number when the page has 20 or more jobs, else `null`.
  - All jobs of a page share one `fetchedAt`.
- `health`: request page 1. `ok: true` when it has at least one job. With none: `{ ok: false, message: 'No jobs listed for this country code.' }`. On an error: `message` is the error's message.
- `normalize`, from the posting's payload:

| `NormalizedJob` field | Value |
| --- | --- |
| `externalId` | `<company>/<slug>` from `guid`; a guid that does not match is `invalid_input` |
| `companyName` | `companyName`, trimmed; empty or missing is `invalid_input`. Not `source.name` |
| `title` | `title`, trimmed; empty or missing is `invalid_input` |
| `description` | `htmlToPlainText(description)`; `''` when null, missing or not a string |
| `locationPolicy` | always `'remote'`: the board lists remote jobs only |
| `locationText` | always `null` (decision 0017, D7). Never build a location line from the country list |
| `locationCountry` | always `null` |
| `remoteCountries` | each name in `locationRestrictions` through `countryCodeOf`; names it returns `null` for are dropped; duplicates dropped, first occurrence kept, order kept; `null` when nothing is left, or when the field is missing or not an array |
| `employmentType` | `'contractor'` when `employmentType === 'Contractor'`, else `'unknown'` |
| `salary` | always `{ source: 'unknown' }` (decision 0017, D8). Do not read `minSalary`, `maxSalary`, `salaryPeriod` or `currency` |
| `applyUrl` | `applicationLink`, exactly as given; missing or not http(s) is `invalid_input` |
| `postedAt` | `new Date(pubDate * 1000)` when `pubDate` is a finite number, else `null` |

- Parse with a Zod `looseObject`, the way `ashby.ts` does, with `.catch(null)` on the optional fields so one odd field never rejects a posting.

**What the fixture must normalize to** (source `{ name: 'Himalayas', config: { token: 'XT' } }`)

| # | `externalId` | `companyName` | `title` | `remoteCountries` | `employmentType` | `postedAt` |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | `ejemplo-digital/senior-backend-engineer` | `Ejemplo Digital` | `Senior Backend Engineer` | 45 codes, listed below | `unknown` | `2026-11-11T12:26:40.000Z` |
| 1 | `fixture-annotations/data-labeling-contractor` | `Fixture Annotations` | `Data Labeling Contractor` | `null` | `contractor` | `2026-11-10T08:40:00.000Z` |
| 2 | `nombres-raros/support-engineer` | `Nombres Raros` | `Support Engineer` | `['TR', 'RU', 'CD', 'HK', 'SV', 'CI']` | `unknown` | `2026-11-09T04:53:20.000Z` |
| 3 | `solo-pais/field-engineer` | `Solo País S.A. de C.V.` | `Field Engineer` | `['SV']` | `unknown` | `null` |
| 4 | `followed-co/platform-engineer` | `Followed Co, Inc.` | `Platform Engineer` | `['US', 'SV']` | `unknown` | `2026-11-08T01:06:40.000Z` |
| 5 | `lugar-desconocido/design-intern` | `Lugar Desconocido` | `Design Intern` | `null` | `unknown` | `2026-11-06T21:20:00.000Z` |

- Job 0's `remoteCountries`, in order: `AI, AG, AR, AW, BS, BB, BZ, BM, BO, BQ, BR, KY, CL, CO, CR, CU, DM, DO, EC, SV, FK, GD, GT, GY, HT, HN, JM, MX, MS, NI, PA, PY, PE, PR, KN, LC, VC, GS, SR, TT, TC, UY, VE, VG, VI`.
- Job 0's `description` is exactly `"Ejemplo Digital builds billing tools for clinics & labs.\n\n\nWHAT YOU WILL DO\n\n * Design Node.js services\n * Review code\n\nLocation: Remote, LATAM\n\nOriginally posted on Himalayas"`. Job 3's is `''`.
- Every job: `locationPolicy: 'remote'`, `locationText: null`, `locationCountry: null`, `salary: { source: 'unknown' }`, and `applyUrl` equal to that job's `applicationLink` in the fixture, character for character.

**The migration**

- Run `pnpm db:generate --name himalayas-adapter`. The file must contain exactly these two statements:

```sql
ALTER TABLE "job_sources" DROP CONSTRAINT "job_sources_adapter_key_check";--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_adapter_key_check" CHECK ("job_sources"."adapter_key" in ('greenhouse', 'lever', 'ashby', 'himalayas'));
```

- If it contains anything else, stop and report without applying it. If it matches, run `pnpm db:migrate`: the database tests below need to insert `himalayas` rows. Commit the migration with its `drizzle/meta` files.

**Polling once a day** (`dispatchSourcePolls`)

- Read every enabled source's `id`, `adapterKey` and `lastPolledAt`, ordered by `id`. For each, the interval is `getAdapter(adapterKey).pollEveryMs ?? POLL_INTERVAL_MS`. The source is due when `lastPolledAt` is null or at least one interval old. Its `pollId` is `` `w${Math.floor(now.getTime() / interval) * interval}` ``.
- The existing dispatch tests must pass unmodified.

**New in `job-sources/service.ts`**, exported from `index.ts`:

```ts
/** Whether the source is one company's own board, not a job board listing many. */
export async function isCompanyBoard(db: Db, sourceId: string): Promise<boolean>          // adapter kind === 'ats'; false for an unknown id
/** The names of the enabled sources that are a company's own board. */
export async function listFollowedCompanyNames(db: Db): Promise<string[]>
export type SourceCredit = { readonly name: string; readonly url: string }
/** The credit each source's terms require wherever its jobs are shown, by source id. Sources without one are absent. */
export async function listSourceCredits(db: Db): Promise<Map<string, SourceCredit>>
```

**Leaving out a followed company's job** (decision 0017, D9). New in `jobs/service.ts`, exported from `jobs/index.ts`:

```ts
/**
 * The page's postings that may become jobs. A job board's copy of a job from a company
 * followed on its own board is left out: that board has the same job (decision 0017).
 */
export async function withoutFollowedCompanies(
  db: Db, input: { readonly sourceId: string; readonly postings: readonly PagePosting[] },
): Promise<readonly PagePosting[]>
```

- When `isCompanyBoard(db, sourceId)`, return `postings` unchanged, with no further queries.
- Otherwise build the set `normalizeCompany(name)` over `listFollowedCompanyNames(db)`, and drop each posting whose `readNormalizedPosting(db, rawJobId)` succeeds with a `job.companyName` that normalizes into that set. A posting that fails to normalize is kept: normalization reports it.
- In `src/worker.ts`, `handlePollPage`, pass the result to `recordSightings`:

```ts
  const postings = await withoutFollowedCompanies(db, { sourceId: page.sourceId, postings: page.postings })
  const { rawJobIdsToNormalize } = await recordSightings(db, { sourceId: page.sourceId, postings, seenAt: page.fetchedAt })
```

  Nothing else in the worker changes. A posting left out is never sighted, so a job it already had is closed by `closeUnseenJobs` at the end of that poll.

**The jobs view**

- `formatLocation(job: Pick<JobSummary, 'locationText' | 'remoteCountries'>): string`:
  - the `locationText` when there is one;
  - else, with one to three `remoteCountries`: `Remote · ` and their English names joined by `, `, from `new Intl.DisplayNames(['en'], { type: 'region' })`;
  - else, with more: `` `Remote · ${n} countries` ``;
  - else `Location not stated`.
- `src/app/jobs/page.tsx` and `src/app/jobs/[jobId]/page.tsx` load `listSourceCredits(db)` beside their other reads. Where a job's source has a credit, show it after the "Posted …" text in the company line, on both the row and the job page: `· via ` followed by `<a href={credit.url} target="_blank" rel="noopener noreferrer">{credit.name}</a>`. `JobRow` gets a `credit: SourceCredit | null` prop.
- `src/app/sources/page.tsx`: `ADAPTER_LABELS` gains `himalayas: 'Himalayas'`. The subtitle becomes "Connect company boards and job boards to capture their postings. Enabled sources are polled every six hours, job boards once a day." The add-form hint becomes "Use the company name and its Greenhouse board token, Lever site name, or Ashby job board name. For Himalayas, use a two-letter country code."

**Tests and the database**

- Database tests run inside a transaction against the developer's real database. Any Himalayas source a test adds uses the token `XT` (a code no country has), never `SV`.
- The followed-company test adds a Greenhouse source named exactly `Followed Co` (it normalizes to `followed`, as the fixture's `Followed Co, Inc.` does), with a random token.

### Dependencies

No new dependencies.

### Tests required

Adapter (`himalayas.test.ts`, fixture and stubbed fetchers):

- Normalization: all six fixture jobs give exactly the values in the table above, including job 0's description and each `applyUrl`.
- Normalization never throws: a payload missing `title`, missing `companyName`, with an `applicationLink` of `javascript:alert(1)`, or with a `guid` on another host is `invalid_input`; `description: 12`, `locationRestrictions: 'El Salvador'` and `pubDate: 'soon'` give `''`, `null` and `null` without rejecting the posting.
- `fetchPage` with a null cursor requests exactly `https://himalayas.app/jobs/api/search?country=XT&sort=recent&page=1`, returns six raw jobs with the external ids above sharing one `fetchedAt`, and `next: null`.
- A page of 20 jobs (the fixture's first job repeated with 20 distinct guids) returns `next: '2'`.
- With fake timers, `fetchPage` with cursor `'2'` makes no request until 1,500 ms have passed, then requests `page=2`.
- Cursors `'0'`, `'abc'` and `'2.5'` are `invalid_input`; cursor `'501'` is `upstream_failed`; a token of `sv` or `USA` is `invalid_input`. None of these makes a request.
- A response without `jobs`, and one whose job has a guid on another host, are `validation_failed`; HTTP 500 is `upstream_failed`.
- `health`: ok for the fixture; not ok with `No jobs listed for this country code.` for `{ jobs: [] }`; not ok with `Use a two-letter country code, such as SV.` for the token `sv`, with no request made.

Sources (`job-sources/service.test.ts`):

- `dispatchSourcePolls`: a Himalayas source last polled 7 hours ago is not requested; one last polled 25 hours ago is, with `pollId` `` `w${Math.floor(now.getTime() / 86_400_000) * 86_400_000}` ``. The existing dispatch tests pass unmodified.
- `listFollowedCompanyNames` includes an enabled Greenhouse source's name, and excludes a disabled one's and a Himalayas source's.
- `isCompanyBoard` is true for a Greenhouse source, false for a Himalayas source and for an unknown id.
- `listSourceCredits` maps a Himalayas source's id to `{ name: 'Himalayas', url: 'https://himalayas.app' }` and has no entry for a Greenhouse source.

Jobs (`jobs/service.test.ts`), with the fixture polled into a Himalayas source through `pollSourcePage`:

- `withoutFollowedCompanies` returns all six postings when no source is named `Followed Co`; five, without `followed-co/platform-engineer`, once an enabled Greenhouse source has that name; six again after that source is disabled.
- `withoutFollowedCompanies` returns a Greenhouse source's postings unchanged.
- `upsertJobFromRaw` on `solo-pais/field-engineer` stores `remoteCountries: ['SV']`, `locationText: null`, `locationPolicy: 'remote'`, `salary: { source: 'unknown' }` and `companyName: 'Solo País S.A. de C.V.'`.
- A job that stops being sighted closes: sight and normalize all six, add the `Followed Co` source, then `recordSightings` with the five kept postings at a later `seenAt` and `closeUnseenJobs` with a `pollStartedAt` between the two sightings. It reports `closed: 1`, and the `followed-co/platform-engineer` job has a `closedAt`.

Jobs view (`format.test.ts`):

- `formatLocation` gives `Remote, LATAM` for that text with or without a list; `Remote · El Salvador` for `['SV']`; `Remote · United States, El Salvador, Mexico` for `['US', 'SV', 'MX']`; `Remote · 4 countries` for four codes; `Location not stated` with neither.

Adapter tests run against committed fixtures, never the live network.

### Definition of done

1. `pnpm typecheck && pnpm test && pnpm lint` all pass.
2. The new migration holds exactly the two statements above, and is applied and committed.
3. `git diff --stat <start>..HEAD -- src/modules/eligibility src/modules/matching src/modules/jobs/fingerprint.ts src/modules/job-sources/country-names.ts src/modules/job-sources/__fixtures__ src/modules/job-sources/http.ts evals docs/decisions docs/eligibility-spec.md` prints nothing.
4. `grep -rln "himalayas.app/jobs/api" src` lists only `src/modules/job-sources/adapters/himalayas.ts` and its test.
5. `grep -c '"adapterKey": "himalayas"' scripts/seed-sources.json` prints `1`, and the file parses as JSON.
6. `grep -rn "minSalary\|maxSalary\|expiryDate" src/modules/job-sources/adapters/himalayas.ts` prints nothing.
7. No source row with adapter `himalayas` exists in the database after the test run: `pnpm test` leaves none, and you added none.

### Report back

- Files changed
- Anything you decided that this brief did not specify
- Anything you could not do, and why
- The output of the verification commands, and of checks 3 to 6

Do not report success with failing checks. Do not loosen types, skip tests, or add `any` to make a check pass.
