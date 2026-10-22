import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import {
  assessEligibility,
  EligibilityClaimsSchema,
  eligibilityProfileOf,
  extractClaimsTask,
  extractClaimsWithModel,
  RULE_IDS,
  UNSPECIFIED_CLAIMS,
  validateQuotes,
  type EligibilityClaims,
  type EligibilityJob,
  type EligibilityVerdict,
} from '@/modules/eligibility'
import { CandidateProfileInputSchema } from '@/modules/profiles'

/*
 * `pnpm eval:eligibility`: the engine's measurement (docs/eligibility-spec.md, Evaluation).
 * Runs every labeled (posting, profile) pair through the real pipeline and the real model.
 * Extraction output is cached per prompt version in evals/.cache, so a rule-only change
 * re-runs for free; a prompt change (new version) re-extracts.
 */

const VERDICTS = ['eligible', 'not_eligible', 'needs_review'] as const

const LabelSchema = z.object({
  verdict: z.enum(VERDICTS),
  acceptableRules: z.array(z.enum(RULE_IDS)),
  reason: z.string(),
  quote: z.string(),
  basis: z.enum(['stated', 'location-only']),
})
const CaseSchema = z.object({
  id: z.string(),
  jobId: z.uuid(),
  category: z.string(),
  posting: z.object({
    company: z.string(),
    title: z.string(),
    locationText: z.string().nullable(),
    locationPolicy: z.enum(['onsite', 'hybrid', 'remote', 'unknown']),
    locationCountry: z.string().nullable(),
    employmentType: z.string(),
    salary: z.discriminatedUnion('source', [
      z.object({ source: z.literal('unknown') }),
      z.object({ source: z.literal('posted'), minMinor: z.number().nullable(), maxMinor: z.number().nullable(), currency: z.string() }),
    ]),
    description: z.string(),
  }),
  labels: z.record(z.string(), LabelSchema),
})
type Case = z.infer<typeof CaseSchema>
const ProfilesSchema = z.record(z.string(), z.object({ about: z.string(), profile: CandidateProfileInputSchema }))

const CacheSchema = z.record(z.string(), z.object({
  claims: EligibilityClaimsSchema.nullable(),
  error: z.string().nullable(),
  costMicroUsd: z.number(),
  model: z.string().nullable(),
}))
type CacheEntry = z.infer<typeof CacheSchema>[string]

const TARGETS = { precision: 0.95, recall: 0.8, reviewShare: 0.25, quoteRate: 0.98 }
const CACHE_PATH = 'evals/.cache/claims.json'

const profiles = ProfilesSchema.parse(JSON.parse(readFileSync('evals/profiles.json', 'utf8')))
const cases = readFileSync('evals/dataset.jsonl', 'utf8').trim().split('\n').map((line) => CaseSchema.parse(JSON.parse(line)))
const cache: Record<string, CacheEntry> = existsSync(CACHE_PATH) ? CacheSchema.parse(JSON.parse(readFileSync(CACHE_PATH, 'utf8'))) : {}

function jobOf(c: Case): EligibilityJob {
  const { posting } = c
  const posted = posting.salary.source === 'posted' ? posting.salary : null
  return {
    id: c.jobId, title: posting.title, locationText: posting.locationText, description: posting.description,
    locationPolicy: posting.locationPolicy, locationCountry: posting.locationCountry,
    salaryMinMinor: posted?.minMinor ?? null, salaryMaxMinor: posted?.maxMinor ?? null,
    salaryCurrency: posted?.currency ?? null, salarySource: posting.salary.source,
  }
}

const keyOf = (text: string) => `${extractClaimsTask.name}@${extractClaimsTask.version}:${createHash('sha256').update(text).digest('hex')}`

let modelCalls = 0
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
// Provider rate limits (HTTP 429) reset over seconds; the client's own retries wait under one.
const RATE_LIMIT_WAITS_MS = [5_000, 10_000, 20_000, 40_000, 60_000]

async function extractCached(text: string): Promise<CacheEntry> {
  const key = keyOf(text)
  const hit = cache[key]
  if (hit) return hit
  for (let attempt = 0; ; attempt++) {
    modelCalls++
    const result = await extractClaimsWithModel(text)
    const cost = (result.ok ? result.value.traces : result.error.traces).reduce((s, t) => s + t.costMicroUsd, 0)
    if (result.ok) {
      const entry = { claims: result.value.value, error: null, costMicroUsd: cost, model: result.value.traces.at(-1)?.model ?? null }
      cache[key] = entry
      return entry
    }
    const wait = RATE_LIMIT_WAITS_MS[attempt]
    if ((result.error.code === 'upstream_failed' || result.error.code === 'rate_limited') && wait !== undefined) {
      await sleep(wait)
      continue
    }
    // Not cached: a failed extraction is retried on the next run, never stored as an answer.
    return { claims: null, error: `${result.error.code}: ${result.error.message}`, costMicroUsd: cost, model: null }
  }
}

type Outcome = {
  readonly c: Case
  readonly profile: string
  readonly expected: z.infer<typeof LabelSchema>
  readonly verdict: EligibilityVerdict
  readonly stage: string
  readonly extractionError: string | null
}

const quotesOf = (claims: EligibilityClaims) =>
  [claims.remoteScope, claims.authorization, claims.timezone, claims.employmentType, claims.relocation, claims.onsite]
    .filter((claim) => claim.quote !== undefined).length

const outcomes: Outcome[] = []
let quotesReturned = 0
let quotesStripped = 0
let claimsUnquoted = 0
const extractedCases = new Set<string>()

async function runCase(c: Case): Promise<void> {
  const job = jobOf(c)
  for (const [profileId, expected] of Object.entries(c.labels)) {
    const entry = profiles[profileId]
    if (!entry) throw new Error(`${c.id}: unknown profile ${profileId}`)
    let extractionError: string | null = null
    const { verdict, stage } = await assessEligibility(eligibilityProfileOf(entry.profile), job, async (text) => {
      const extracted = await extractCached(text)
      extractionError = extracted.error
      if (!extracted.claims) return UNSPECIFIED_CLAIMS
      if (!extractedCases.has(c.id)) {
        extractedCases.add(c.id)
        const checked = validateQuotes(extracted.claims, job)
        quotesReturned += quotesOf(extracted.claims)
        quotesStripped += checked.stripped
        claimsUnquoted += checked.unquoted
      }
      return extracted.claims
    })
    outcomes.push({ c, profile: profileId, expected, verdict, stage, extractionError })
  }
}

// One case at a time: the provider's rate limit is the bottleneck, not this process.
for (const c of cases) await runCase(c)
mkdirSync('evals/.cache', { recursive: true })
writeFileSync(CACHE_PATH, JSON.stringify(cache))

// ---------------------------------------------------------------------------
// Report

const count = (predicate: (o: Outcome) => boolean) => outcomes.filter(predicate).length
const predictedN = count((o) => o.verdict.verdict === 'not_eligible')
const labeledN = count((o) => o.expected.verdict === 'not_eligible')
const trueN = count((o) => o.verdict.verdict === 'not_eligible' && o.expected.verdict === 'not_eligible')
const metrics = {
  precision: predictedN === 0 ? 1 : trueN / predictedN,
  recall: labeledN === 0 ? 1 : trueN / labeledN,
  reviewShare: count((o) => o.verdict.verdict === 'needs_review') / outcomes.length,
  quoteRate: quotesReturned === 0 ? 1 : (quotesReturned - quotesStripped) / quotesReturned,
}
const passes = {
  precision: metrics.precision >= TARGETS.precision,
  recall: metrics.recall >= TARGETS.recall,
  reviewShare: metrics.reviewShare <= TARGETS.reviewShare,
  quoteRate: metrics.quoteRate >= TARGETS.quoteRate,
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const lines: string[] = []
const say = (line = '') => lines.push(line)
const costMicroUsd = Object.values(cache).reduce((s, e) => s + e.costMicroUsd, 0)

say(`Eligibility eval: ${cases.length} postings, ${outcomes.length} labeled verdicts, prompt ${extractClaimsTask.name}@${extractClaimsTask.version}`)
say(`Model calls this run: ${modelCalls} (cached extractions cost $${(costMicroUsd / 1e6).toFixed(4)} in total)`)
say()
say(`| Metric | Value | Target | |`)
say(`| --- | --- | --- | --- |`)
say(`| Precision on not_eligible | ${pct(metrics.precision)} (${trueN}/${predictedN}) | ≥ ${pct(TARGETS.precision)} | ${passes.precision ? 'PASS' : 'FAIL'} |`)
say(`| Recall on not_eligible | ${pct(metrics.recall)} (${trueN}/${labeledN}) | ≥ ${pct(TARGETS.recall)} | ${passes.recall ? 'PASS' : 'FAIL'} |`)
say(`| needs_review share | ${pct(metrics.reviewShare)} | ≤ ${pct(TARGETS.reviewShare)} | ${passes.reviewShare ? 'PASS' : 'FAIL'} |`)
say(`| Quote validation rate | ${pct(metrics.quoteRate)} (${quotesReturned - quotesStripped}/${quotesReturned}) | ≥ ${pct(TARGETS.quoteRate)} | ${passes.quoteRate ? 'PASS' : 'FAIL'} |`)
say()
say(`Decided by structured fields alone (no model): ${count((o) => o.stage === 'structured')} of ${outcomes.length}`)
say(`Claims stated without a quote (reset to unspecified): ${claimsUnquoted}`)
const errors = outcomes.filter((o) => o.extractionError !== null)
if (errors.length > 0) say(`Extraction failures: ${new Set(errors.map((o) => o.c.id)).size} postings (treated as unspecified)`)
say()
say('Confusion (rows: label, columns: engine)')
say(`| | ${VERDICTS.join(' | ')} |`)
say(`| --- | --- | --- | --- |`)
for (const label of VERDICTS) say(`| ${label} | ${VERDICTS.map((p) => count((o) => o.expected.verdict === label && o.verdict.verdict === p)).join(' | ')} |`)
const locationOnly = outcomes.filter((o) => o.expected.basis === 'location-only')
say()
say(`Location-only labels: ${locationOnly.filter((o) => o.verdict.verdict === o.expected.verdict).length} of ${locationOnly.length} matched`)

const explain = (v: EligibilityVerdict) =>
  v.verdict === 'not_eligible' ? `[${v.ruleId}] ${v.reason}` : v.verdict === 'needs_review' ? v.openQuestions.join(' / ') : 'eligible'
const misses = outcomes.filter((o) => o.verdict.verdict !== o.expected.verdict)
const order = (o: Outcome) => (o.verdict.verdict === 'not_eligible' ? 0 : o.expected.verdict === 'not_eligible' ? 2 : 1)
say()
say(`Mismatches: ${misses.length} (false rejections first)`)
for (const o of misses.sort((a, b) => order(a) - order(b))) {
  say(`- ${o.verdict.verdict === 'not_eligible' ? 'FALSE REJECTION ' : ''}${o.c.id} [${o.profile}] label ${o.expected.verdict} → engine ${o.verdict.verdict} (${o.stage})`)
  say(`    label: ${o.expected.reason} «${o.expected.quote}»`)
  say(`    engine: ${explain(o.verdict)}${o.extractionError ? ` [extraction failed: ${o.extractionError}]` : ''}`)
}

const report = lines.join('\n')
console.log(report)
writeFileSync('evals/.cache/last-report.md', report + '\n')
if (!Object.values(passes).every(Boolean)) process.exitCode = 1
