## Task: Read public Ashby job boards as a third source, beside Greenhouse and Lever

**Milestone:** S.4 (sources track, alongside phase 2)
**Read first:** `AGENTS.md`, `docs/conventions.md`, `docs/architecture.md` (module boundaries), and the two existing adapters, `src/modules/job-sources/adapters/lever.ts` and `src/modules/job-sources/adapters/greenhouse.ts`, with their tests.

### Goal

Many remote-first companies hiring in Latin America publish their jobs on Ashby, not Greenhouse or Lever. On 2026-10-29 we found 98 such boards, with about 3,200 open jobs. After this task the system reads any public Ashby job board through Ashby's documented job-postings API, the same way it reads Greenhouse and Lever boards: stored verbatim in `raw_jobs`, normalized, then passed downstream to dedupe, eligibility and matching, which need no changes. Ashby application forms are **not** part of this task. Ashby jobs show "Apply yourself", like Lever jobs do today.

Ashby's terms were checked on 2026-10-29. Its only terms bind its customers (the employers). It publishes no terms for website visitors. The job-postings API is public, needs no login, and is documented for showing an employer's openings. Reading it is the same position as Greenhouse's job board API.

### Scope

**In scope**
- New `src/modules/job-sources/adapters/ashby.ts`: the adapter.
- New `src/modules/job-sources/adapters/ashby.test.ts`: its tests.
- New `src/modules/job-sources/salary.ts` (+ `salary.test.ts` if you add cases beyond the adapters' tests): the annual-salary conversion Lever already does, moved out so both adapters use it (see notes).
- `src/modules/job-sources/adapters/lever.ts`: use the shared conversion. **Lever's behavior must not change; `lever.test.ts` must pass unmodified.**
- `src/modules/job-sources/adapter.ts`: add `'ashby'` to `ADAPTER_KEYS`; update the `AdapterConfigSchema` comment to mention Ashby's job board name.
- `src/modules/job-sources/registry.ts`: register the adapter.
- `src/modules/job-sources/test-fixtures.ts`: export `ashbyFixture`, parsed like the others.
- A generated migration: `pnpm db:generate --name ashby-adapter`. It should only replace the `job_sources_adapter_key_check` constraint so it allows `'ashby'`. Commit it. **Do not apply it** (`pnpm db:migrate`).
- `src/app/sources/page.tsx`: the adapter `<select>` labels come from a `Record<AdapterKey, string>` (`Greenhouse`, `Lever`, `Ashby`) instead of the current two-way ternary.
- `scripts/seed-sources.json`: append the 98 entries listed at the end of this brief, after the last existing entry, in the order given.
- `docs/domain-model.md`, the `job_sources` paragraph: `adapter_key` is `greenhouse` | `lever` | `ashby`; `config.token` is also "the Ashby job board name".

**Already in the repo, do not change:** `src/modules/job-sources/__fixtures__/ashby-board.json`. It holds eight real jobs saved verbatim from Ashby's API on 2026-10-29 (`{ apiVersion, jobs: [...] }`), chosen to cover each case below.

**Out of scope.** Do not touch these, even if they look wrong:
- Application forms: no `fetchApplicationForm`, `applicationPages` or `readApplicationForm` for Ashby.
- Everything outside `src/modules/job-sources/`, except the files named above.
- Dedupe, normalization into `jobs`, eligibility, matching: they are source-agnostic and need nothing.
- **The dev database.** Tests run against it, so do not run `pnpm db:migrate` or `pnpm sources:seed`. Do not write any test that inserts an `ashby` source row: until the migration is applied, the database refuses it. Claude Code applies the migration and runs the seed after review.
- The live network. Tests use the committed fixture and stubbed fetchers only.

### Interfaces you implement against

These exist in `src/modules/job-sources/adapter.ts`. Do not modify them, except `ADAPTER_KEYS` as stated. If one is wrong for the task, stop and report it.

```ts
export const ADAPTER_KEYS = ['greenhouse', 'lever'] as const        // → ['greenhouse', 'lever', 'ashby']
export type AdapterKey = z.infer<typeof AdapterKeySchema>

export type NormalizedSalary =
  | { source: 'unknown' }
  | { source: 'posted'; minMinor: number | null; maxMinor: number | null; currency: string }  // at least one bound; min <= max

export type NormalizedJob = {
  externalId: string
  companyName: string            // the configured source name: source.name
  title: string                  // verbatim, trimmed
  description: string            // plain text, deterministic (the eligibility engine quotes it)
  locationPolicy: 'onsite' | 'hybrid' | 'remote' | 'unknown'
  locationText: string | null
  locationCountry: string | null // ISO 3166-1 alpha-2 from a structured field only; never parsed from free text
  employmentType: 'employee' | 'contractor' | 'eor' | 'unknown'
  salary: NormalizedSalary
  applyUrl: string               // http(s) only
  postedAt: Date | null
}

export type RawJob = { readonly externalId: string; readonly payload: unknown; readonly fetchedAt: Date }
export type Cursor = string
export type FetchResult = { readonly raw: readonly RawJob[]; readonly next: Cursor | null }
export type SourceHealth = { readonly ok: boolean; readonly checkedAt: Date; readonly message?: string }
export type SourceRef = { readonly name: string; readonly config: { token: string } }
export type Fetcher = typeof fetch

export type JobSourceAdapter = {
  readonly key: AdapterKey
  readonly kind: 'ats' | 'board' | 'aggregator'
  readonly volatileKeys: readonly string[]
  /** One page. Network failures and non-2xx are `upstream_failed` (404: `not_found`); a mismatched envelope is `validation_failed`. */
  fetchPage(source: SourceRef, cursor: Cursor | null, fetcher: Fetcher): Promise<Result<FetchResult>>
  /** Pure and deterministic: no I/O, no clock. A payload missing a required field is `invalid_input`. Never throws. */
  normalize(raw: RawJob, source: SourceRef): Result<NormalizedJob>
  /** Used when a source is registered. Never throws. */
  health(source: SourceRef, fetcher: Fetcher): Promise<SourceHealth>
  // fetchApplicationForm?, applicationPages?, readApplicationForm?: leave absent for Ashby
}

// src/modules/job-sources/http.ts
getJson<S extends z.ZodType>(url: string, schema: S, fetcher: Fetcher): Promise<Result<z.output<S>>>
  // sets Accept and User-Agent, 30 s timeout, no redirects; 404 → not_found, other non-2xx → upstream_failed,
  // bad JSON or schema mismatch → validation_failed

// src/modules/job-sources/html-text.ts
htmlToPlainText(html: string): string
```

**Ashby's API** (documented at `https://developers.ashbyhq.com/docs/public-job-posting-api`):
`GET https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true` returns every published job in one response, with no pagination: `{ apiVersion: "1", jobs: Job[] }`. An unknown board returns HTTP 404. The `Job` fields this task reads:

```ts
type AshbyJob = {
  id: string                       // a UUID
  title: string
  location: string | null          // e.g. "Remote, Global", "Bogotá", "LatAm"
  secondaryLocations: { location: string | null; address?: unknown }[]
  workplaceType: 'Remote' | 'Hybrid' | 'OnSite' | null
  isRemote: boolean | null         // true for Remote AND Hybrid: do not use it for locationPolicy
  employmentType: string | null    // seen: "FullTime", "Contract", "Intern"
  address: { postalAddress?: { addressCountry?: string } } | null   // country is often a name ("Colombia", "USA"), sometimes ISO ("CO")
  isListed: boolean
  publishedAt: string              // ISO 8601
  jobUrl: string
  applyUrl: string
  descriptionHtml: string
  descriptionPlain: string         // headings uppercased by Ashby: not used
  compensation?: { summaryComponents?: { compensationType: string; interval: string; currencyCode: string | null; minValue: number | null; maxValue: number | null }[] }
}
```

### Implementation notes

**The adapter:** `ashbyAdapter: JobSourceAdapter = { key: 'ashby', kind: 'ats', volatileKeys: [], ... }`.

**`fetchPage(source, cursor, fetcher)`**
- If `cursor !== null`, return `invalid_input` ("Ashby boards have one page.") without fetching.
- Fetch exactly `https://api.ashbyhq.com/posting-api/job-board/${source.config.token}?includeCompensation=true` with `getJson`.
- Envelope schema: `z.object({ jobs: z.array(z.looseObject({ id: z.string().min(1) })) })`, loose at the top level too, so `apiVersion` and future fields pass.
- Drop jobs whose `isListed === false`. Keep every other job's payload verbatim, as returned: no field removed or reshaped. `externalId` is the job's `id`. Use one `fetchedAt = new Date()` for the page.
- Always `next: null`.

**`normalize(raw, source)`**
- Parse with a loose Zod schema. Required: `id` (non-empty), `title` (trimmed, non-empty), `jobUrl` (an http(s) URL). Everything else is optional or nullable, and a malformed optional field makes only that value unknown, never the posting invalid. The one exception is `applyUrl`: a present `applyUrl` that is not http(s) rejects the posting, as in Lever.
- On a parse failure, return `invalid_input` with the message `Posting ${raw.externalId}: invalid ${path}`, as Lever does.
- **The fields:**

| Field | Rule |
| --- | --- |
| `externalId` | `id` |
| `companyName` | `source.name` |
| `title` | `title.trim()` |
| `description` | `htmlToPlainText(descriptionHtml)` when `descriptionHtml` is a non-empty string; otherwise `descriptionPlain.trim()` when it is a string; otherwise `''` |
| `locationPolicy` | `workplaceType`: `Remote` → `remote`, `Hybrid` → `hybrid`, `OnSite` → `onsite`; anything else, including `null`, → `unknown`. **Never** derive it from `isRemote`: Ashby sets it for hybrid jobs too |
| `locationText` | `location` then each `secondaryLocations[].location`, each trimmed, empty ones dropped, duplicates removed in first-seen order, joined with `"; "`; `null` when none remain |
| `locationCountry` | `address.postalAddress.addressCountry` only when it matches `/^[A-Z]{2}$/` **and** `secondaryLocations` is empty (a job in several places has no single country); otherwise `null`. Never map country names to codes |
| `employmentType` | `"Contract"` → `contractor`; anything else → `unknown` |
| `salary` | From `compensation.summaryComponents`: take the components whose `compensationType === 'Salary'`. Only if there is **exactly one** and its `interval === '1 YEAR'`, pass its `minValue`, `maxValue` and `currencyCode` to the shared conversion below; otherwise `{ source: 'unknown' }`. A missing or malformed `compensation` is `unknown`, not a rejection |
| `applyUrl` | `applyUrl` when present, else `jobUrl` |
| `postedAt` | `new Date(publishedAt)` when `publishedAt` is a string giving a finite time; otherwise `null` |

**The shared salary conversion** (`src/modules/job-sources/salary.ts`). Move Lever's `salaryBound` and the minor-unit conversion out of `salaryFromRange` into:

```ts
/** An annual salary in the currency's minor units, or unknown when anything is ambiguous. Pure. */
export function annualSalary(min: unknown, max: unknown, currency: unknown): NormalizedSalary
```

It covers everything `salaryFromRange` does after the `interval` check:
- the currency must be a string matching `/^[A-Z]{3}$/`;
- each bound is absent (`undefined` or `null`), usable (a finite number ≥ 0), or unusable (anything else), and an unusable bound makes the result `unknown`;
- at least one bound is required, and `min <= max`;
- minor units come from `Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits`, and any bound that isn't a safe integer makes the result `unknown`.

`salaryFromRange` in Lever keeps its own `interval === 'per-year-salary'` check, then calls `annualSalary`. This is the only change to `lever.ts`.

**`health(source, fetcher)`**
- Fetch the same URL **without** `includeCompensation`: `https://api.ashbyhq.com/posting-api/job-board/${token}`.
- Envelope schema: `z.looseObject({ jobs: z.array(z.unknown()) })`.
- `{ ok: true, checkedAt }` on success, including an empty `jobs`. On `not_found`, message `'Board not found'`. Otherwise the error's message. Never throws.

### Dependencies

No new dependencies.

### Tests required

All tests are in `ashby.test.ts`, mirroring `lever.test.ts`, against `ashbyFixture` and stubbed fetchers. None touch the database.

1. **Normalization of the fixture.** Each job normalizes to exactly these values (also check `companyName: 'Fixture Co'`; `description` contains no `<` and no `&lt;`; and normalizing twice gives equal results):

| id | title (trimmed) | locationPolicy | locationText | locationCountry | employmentType | salary | postedAt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `54bbf446-8b59-419d-b52e-035ed06fa645` | Principal Database Performance Engineer - Core Engineering (C++) | remote | `Germany; United Kingdom; Spain; The Netherlands` | null | unknown | unknown | 2026-09-17T00:20:07.216Z |
| `dc0ec843-13a4-4032-9992-7e7a924228c8` | Senior Product Manager, Billing & Marketplaces | hybrid | `Europe; Portugal; France; United Kingdom; Italy; Israel; The Netherlands` | null | unknown | unknown | 2026-10-17T01:32:48.831Z |
| `47e36408-41dd-4631-af71-3630bf386f2f` | Agente de Servicio al Cliente \| Programa de Inclusión | onsite | `Bogotá` | `CO` | unknown | unknown | 2026-07-18T02:45:00.530Z |
| `a069c886-1107-408e-88b4-e1aa8d33d4bc` | Account Executive (EMEA) | unknown | `Remote, EMEA; Europe` | null | unknown | unknown | 2026-08-26T19:59:56.317Z |
| `7f318f1d-6787-4cbe-b20b-59169fcfd048` | Senior Back-End Developer (Java) - Global Insights & Strategy | remote | `LatAm` | null | contractor | unknown | 2026-10-13T20:24:53.886Z |
| `da6f6da1-eabf-4647-ab1c-6e138b14a6fe` | Sr. Frontend Software Engineer - Growth | remote | `United States` | null | unknown | posted 18500000–23000000 USD | 2026-10-27T20:00:19.146Z |
| `a13ae586-f4cb-4385-8822-c42b9b54ed74` | Software Engineering Intern, Frontend | hybrid | `New York, NY (HQ)` | null | unknown | unknown (hourly) | 2026-09-24T00:40:15.975Z |
| `863956bc-9a2e-4531-ba9e-45c409e4f1ca` | Senior Software Engineer - Integrations - AI/ML | remote | `United States` | null | unknown | posted 14700000–23800000 USD | 2026-07-09T12:23:47.348Z |

   For each, `applyUrl` equals the job's `applyUrl` in the fixture. The Addi job (`47e36408-…`) is posted as images only. Its `description` is `''`, which is correct: do not fall back to `descriptionPlain`, which here holds only image URLs. Every other job's description is non-empty.
2. **`workplaceType: null` with `isRemote: true`** (a fixture job with those two fields overridden) → `locationPolicy: 'unknown'`.
3. **Salary stays unknown:**
   - two `Salary` components;
   - `interval: '1 HOUR'`;
   - currency `'usd'` or `null`;
   - `minValue: '85000'`;
   - min > max;
   - no `compensation` at all;
   - `compensation: 'garbage'`.

   Each still normalizes, with `salary: { source: 'unknown' }`.
4. **Fallbacks:**
   - no `applyUrl` → `jobUrl`;
   - `descriptionHtml: ''` with a `descriptionPlain` → the trimmed plain text;
   - `location: null` and no secondary locations → `locationText: null`;
   - `addressCountry: 'Colombia'` → `locationCountry: null`;
   - an invalid `publishedAt` → `postedAt: null`.
5. **Rejections:**
   - a payload `{ id: 'x' }` → `invalid_input` naming the external id and `title`;
   - `applyUrl: 'javascript:alert(1)'` → `invalid_input`.
6. **Requests:**
   - The first page fetches the exact URL above, keeps payloads verbatim, drops an `isListed: false` job, and returns `next: null`.
   - Any cursor → `invalid_input` without fetching.
   - HTTP 404 → `not_found`, 500 → `upstream_failed`.
   - A thrown fetch → `upstream_failed`.
   - `{ postings: [] }` → `validation_failed`.
7. **Health:**
   - Exact URL without `includeCompensation`.
   - `{ jobs: [] }` → ok.
   - 404 → `{ ok: false, message: 'Board not found' }`.
   - A thrown fetch → `ok: false`.
8. **Lever is unchanged:** `lever.test.ts` passes without edits.

Adapter tests run against committed fixtures, never the live network.

### Definition of done

1. `pnpm typecheck && pnpm test && pnpm lint` all pass.
2. `git diff --stat` shows only:
   - the files named in scope;
   - one new file under `drizzle/` named `0020_ashby-adapter.sql`, plus its `drizzle/meta/` updates.
3. That migration's SQL only drops and re-adds `job_sources_adapter_key_check`, now including `'ashby'`.
4. `scripts/seed-sources.json` parses as JSON and has 255 entries, 98 of them with `"adapterKey": "ashby"`.
5. `grep -rn "@/modules/[a-z-]*/" src/app` finds no import below a module's `index.ts`.
6. `grep -n "isRemote" src/modules/job-sources/adapters/ashby.ts` finds no use in deciding `locationPolicy`.

### Report back

- Files changed
- Anything you decided that this brief did not specify
- Anything you could not do, and why
- The output of the verification commands

Do not report success with failing checks. Do not loosen types, skip tests, or add `any`
to make a check pass.

### The 98 entries to append to `scripts/seed-sources.json`

```json
  { "adapterKey": "ashby", "name": "Truelogic", "token": "truelogic" },
  { "adapterKey": "ashby", "name": "Supabase", "token": "supabase" },
  { "adapterKey": "ashby", "name": "Addi", "token": "addi" },
  { "adapterKey": "ashby", "name": "RevenueCat", "token": "revenuecat" },
  { "adapterKey": "ashby", "name": "ClickHouse", "token": "clickhouse" },
  { "adapterKey": "ashby", "name": "SearchApi", "token": "searchapi" },
  { "adapterKey": "ashby", "name": "Oyster", "token": "oyster" },
  { "adapterKey": "ashby", "name": "Snowflake", "token": "snowflake" },
  { "adapterKey": "ashby", "name": "Resend", "token": "resend" },
  { "adapterKey": "ashby", "name": "Circle", "token": "circle" },
  { "adapterKey": "ashby", "name": "Kueski", "token": "kueski" },
  { "adapterKey": "ashby", "name": "Percona", "token": "percona" },
  { "adapterKey": "ashby", "name": "Railway", "token": "railway" },
  { "adapterKey": "ashby", "name": "Monte Carlo", "token": "montecarlodata" },
  { "adapterKey": "ashby", "name": "Webflow", "token": "webflow" },
  { "adapterKey": "ashby", "name": "Sardine", "token": "sardine" },
  { "adapterKey": "ashby", "name": "Capchase", "token": "capchase" },
  { "adapterKey": "ashby", "name": "Hopper", "token": "hopper" },
  { "adapterKey": "ashby", "name": "Belvo", "token": "belvo" },
  { "adapterKey": "ashby", "name": "Redis", "token": "redis" },
  { "adapterKey": "ashby", "name": "Zapier", "token": "zapier" },
  { "adapterKey": "ashby", "name": "TestGorilla", "token": "testgorilla" },
  { "adapterKey": "ashby", "name": "Ramp", "token": "ramp" },
  { "adapterKey": "ashby", "name": "Plaid", "token": "plaid" },
  { "adapterKey": "ashby", "name": "Lightspeed Commerce", "token": "lightspeedhq" },
  { "adapterKey": "ashby", "name": "Zip", "token": "zip" },
  { "adapterKey": "ashby", "name": "Notion", "token": "notion" },
  { "adapterKey": "ashby", "name": "1Password", "token": "1password" },
  { "adapterKey": "ashby", "name": "Headway", "token": "headway" },
  { "adapterKey": "ashby", "name": "Nubank", "token": "nubank" },
  { "adapterKey": "ashby", "name": "Temporal", "token": "temporal" },
  { "adapterKey": "ashby", "name": "Docker", "token": "docker" },
  { "adapterKey": "ashby", "name": "ClickUp", "token": "clickup" },
  { "adapterKey": "ashby", "name": "Hostinger", "token": "hostinger" },
  { "adapterKey": "ashby", "name": "Sentry", "token": "sentry" },
  { "adapterKey": "ashby", "name": "Wealthsimple", "token": "wealthsimple" },
  { "adapterKey": "ashby", "name": "Hex", "token": "hex" },
  { "adapterKey": "ashby", "name": "Render", "token": "render" },
  { "adapterKey": "ashby", "name": "Replit", "token": "replit" },
  { "adapterKey": "ashby", "name": "Linear", "token": "linear" },
  { "adapterKey": "ashby", "name": "Sanity", "token": "sanity" },
  { "adapterKey": "ashby", "name": "Amplitude", "token": "amplitude" },
  { "adapterKey": "ashby", "name": "Pleo", "token": "pleo" },
  { "adapterKey": "ashby", "name": "WorkOS", "token": "workos" },
  { "adapterKey": "ashby", "name": "OpenRouter", "token": "openrouter" },
  { "adapterKey": "ashby", "name": "Litmus", "token": "litmus" },
  { "adapterKey": "ashby", "name": "Virta Health", "token": "virtahealth" },
  { "adapterKey": "ashby", "name": "Elliptic", "token": "elliptic" },
  { "adapterKey": "ashby", "name": "Alchemy", "token": "alchemy" },
  { "adapterKey": "ashby", "name": "Paxos", "token": "paxos" },
  { "adapterKey": "ashby", "name": "MeridianLink", "token": "meridianlink" },
  { "adapterKey": "ashby", "name": "Astronomer", "token": "astronomer" },
  { "adapterKey": "ashby", "name": "Mollie", "token": "mollie" },
  { "adapterKey": "ashby", "name": "Paddle", "token": "paddle" },
  { "adapterKey": "ashby", "name": "Mapbox", "token": "mapbox" },
  { "adapterKey": "ashby", "name": "Gainsight", "token": "gainsight" },
  { "adapterKey": "ashby", "name": "Substack", "token": "substack" },
  { "adapterKey": "ashby", "name": "NerdWallet", "token": "nerdwallet" },
  { "adapterKey": "ashby", "name": "Flip AI", "token": "flip" },
  { "adapterKey": "ashby", "name": "Braintrust", "token": "braintrust" },
  { "adapterKey": "ashby", "name": "Andela", "token": "andela" },
  { "adapterKey": "ashby", "name": "Glitch Productions", "token": "glitch" },
  { "adapterKey": "ashby", "name": "PostHog", "token": "posthog" },
  { "adapterKey": "ashby", "name": "Catalant", "token": "catalant" },
  { "adapterKey": "ashby", "name": "Prelude", "token": "prelude" },
  { "adapterKey": "ashby", "name": "Airbyte", "token": "airbyte" },
  { "adapterKey": "ashby", "name": "Ledger", "token": "ledger" },
  { "adapterKey": "ashby", "name": "Primer", "token": "primer" },
  { "adapterKey": "ashby", "name": "Procurify", "token": "procurify" },
  { "adapterKey": "ashby", "name": "Gorgias", "token": "gorgias" },
  { "adapterKey": "ashby", "name": "Quora", "token": "quora" },
  { "adapterKey": "ashby", "name": "Payscale", "token": "payscale" },
  { "adapterKey": "ashby", "name": "Uniswap Labs", "token": "uniswap" },
  { "adapterKey": "ashby", "name": "Fullstory", "token": "fullstory" },
  { "adapterKey": "ashby", "name": "BetterUp", "token": "betterup" },
  { "adapterKey": "ashby", "name": "Help Scout", "token": "helpscout" },
  { "adapterKey": "ashby", "name": "AirGarage", "token": "airgarage" },
  { "adapterKey": "ashby", "name": "Close", "token": "close" },
  { "adapterKey": "ashby", "name": "Dave", "token": "dave" },
  { "adapterKey": "ashby", "name": "Prefect", "token": "prefect" },
  { "adapterKey": "ashby", "name": "Consensys", "token": "consensys" },
  { "adapterKey": "ashby", "name": "CareMessage", "token": "caremessage" },
  { "adapterKey": "ashby", "name": "Kestra", "token": "kestra" },
  { "adapterKey": "ashby", "name": "Dune", "token": "dune" },
  { "adapterKey": "ashby", "name": "Spruce", "token": "spruce" },
  { "adapterKey": "ashby", "name": "Contra", "token": "contra" },
  { "adapterKey": "ashby", "name": "Wistia", "token": "wistia" },
  { "adapterKey": "ashby", "name": "Nuna", "token": "nuna" },
  { "adapterKey": "ashby", "name": "JOOR", "token": "joor" },
  { "adapterKey": "ashby", "name": "GitBook", "token": "gitbook" },
  { "adapterKey": "ashby", "name": "Checkly", "token": "checkly" },
  { "adapterKey": "ashby", "name": "Sticker Mule", "token": "stickermule" },
  { "adapterKey": "ashby", "name": "Kustomer", "token": "kustomer" },
  { "adapterKey": "ashby", "name": "Mux", "token": "mux" },
  { "adapterKey": "ashby", "name": "WebFX", "token": "webfx" },
  { "adapterKey": "ashby", "name": "Hubstaff", "token": "hubstaff" },
  { "adapterKey": "ashby", "name": "Luxor Technology", "token": "luxor" },
  { "adapterKey": "ashby", "name": "Recharge", "token": "recharge" }
```
