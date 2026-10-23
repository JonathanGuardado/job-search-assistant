import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import {
  extractRequirementsTask,
  extractRequirementsWithModel,
  JobRequirementsSchema,
  postingText,
  skillKey,
  validateRequirements,
  type JobRequirements,
} from '@/modules/matching'

/*
 * `pnpm eval:matching`: how well requirement extraction reads postings (decision 0010).
 * The comparison that follows is deterministic and unit-tested; what needs measuring is
 * whether the skills, years and languages a careful reader would list are the ones the
 * model returns. Labels (evals/matching-labels.jsonl) were written from the full postings
 * and committed before the first run. Extractions are cached per prompt version.
 */

const TARGETS = { quoteRate: 0.98, requiredRecall: 0.85 }

const LabelSchema = z.object({
  jobId: z.uuid(),
  caseId: z.string(),
  /** Each entry is one requirement; "A | B" means naming either satisfies it. */
  required: z.array(z.string()),
  preferred: z.array(z.string()),
  /** Not wrong to extract, at either importance. */
  acceptable: z.array(z.string()),
  minYears: z.number().nullable(),
  languages: z.array(z.object({ language: z.string(), importance: z.enum(['required', 'preferred']) })),
  note: z.string().optional(),
})
type Label = z.infer<typeof LabelSchema>

const PostingSchema = z.object({ jobId: z.uuid(), posting: z.object({ title: z.string(), description: z.string() }) })

const CacheEntrySchema = z.object({ requirements: JobRequirementsSchema, costMicroUsd: z.number() })
type CacheEntry = z.infer<typeof CacheEntrySchema>
const CACHE_PATH = 'evals/.cache/matching-extractions.json'

const labels = readFileSync('evals/matching-labels.jsonl', 'utf8').trim().split('\n').map((line) => LabelSchema.parse(JSON.parse(line)))
const postings = new Map(readFileSync('evals/dataset.jsonl', 'utf8').trim().split('\n')
  .map((line) => PostingSchema.parse(JSON.parse(line))).map((c) => [c.jobId, c.posting]))
const cache: Record<string, CacheEntry> = existsSync(CACHE_PATH) ? z.record(z.string(), CacheEntrySchema).parse(JSON.parse(readFileSync(CACHE_PATH, 'utf8'))) : {}

const keyOf = (text: string) => `${extractRequirementsTask.name}@${extractRequirementsTask.version}:${createHash('sha256').update(text).digest('hex')}`
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const RATE_LIMIT_WAITS_MS = [5_000, 10_000, 20_000, 40_000, 60_000]
let modelCalls = 0

async function extractCached(text: string): Promise<JobRequirements | string> {
  const key = keyOf(text)
  const hit = cache[key]
  if (hit) return hit.requirements
  for (let attempt = 0; ; attempt++) {
    modelCalls++
    const result = await extractRequirementsWithModel(text)
    if (result.ok) {
      cache[key] = { requirements: result.value.value, costMicroUsd: result.value.traces.reduce((s, t) => s + t.costMicroUsd, 0) }
      return result.value.value
    }
    const wait = RATE_LIMIT_WAITS_MS[attempt]
    if ((result.error.code === 'upstream_failed' || result.error.code === 'rate_limited') && wait !== undefined) {
      await sleep(wait)
      continue
    }
    // Not cached: a failed extraction is retried on the next run, never stored as an answer.
    return `${result.error.code}: ${result.error.message}`
  }
}

const alternatives = (entry: string) => entry.split('|').map((name) => skillKey(name.trim()))

type Outcome = {
  readonly label: Label
  readonly error: string | null
  readonly requirements: JobRequirements
  readonly quoted: number
  readonly stripped: number
}

const outcomes: Outcome[] = []
// One posting at a time: the provider's rate limit is the bottleneck, not this process.
for (const label of labels) {
  const posting = postings.get(label.jobId)
  if (!posting) throw new Error(`${label.caseId}: posting not in evals/dataset.jsonl`)
  const text = postingText(posting)
  const extracted = await extractCached(text)
  if (typeof extracted === 'string') {
    outcomes.push({ label, error: extracted, requirements: { skills: [], experience: null, languages: [], other: [] }, quoted: 0, stripped: 0 })
    continue
  }
  const { requirements, quoted, stripped } = validateRequirements(extracted, text)
  outcomes.push({ label, error: null, requirements, quoted, stripped })
}
mkdirSync('evals/.cache', { recursive: true })
writeFileSync(CACHE_PATH, JSON.stringify(cache))

// ---------------------------------------------------------------------------
// Report

let requiredGroups = 0
let requiredFound = 0
let requiredAsRequired = 0
let preferredGroups = 0
let preferredFound = 0
let extractedSkills = 0
let allowedSkills = 0
let languagesLabeled = 0
let languagesFound = 0
let yearsMatched = 0
let quoted = 0
let stripped = 0
const lines: string[] = []
const say = (line = '') => lines.push(line)
const details: string[] = []

for (const o of outcomes) {
  quoted += o.quoted
  stripped += o.stripped
  const byKey = new Map(o.requirements.skills.map((s) => [skillKey(s.name), s]))
  const missed: string[] = []
  const demoted: string[] = []
  for (const group of o.label.required) {
    requiredGroups++
    const hit = alternatives(group).map((key) => byKey.get(key)).find((s) => s !== undefined)
    if (!hit) { missed.push(group); continue }
    requiredFound++
    if (hit.importance === 'required') requiredAsRequired++
    else demoted.push(group)
  }
  for (const group of o.label.preferred) {
    preferredGroups++
    if (alternatives(group).some((key) => byKey.has(key))) preferredFound++
  }
  const allowed = new Set([...o.label.required, ...o.label.preferred, ...o.label.acceptable].flatMap(alternatives))
  const unlabeled = [...byKey.entries()].filter(([key]) => !allowed.has(key)).map(([, s]) => `${s.name} (${s.importance})`)
  extractedSkills += byKey.size
  allowedSkills += byKey.size - unlabeled.length
  const languageMisses = o.label.languages.filter((l) => !o.requirements.languages.some((x) => x.language === l.language))
  languagesLabeled += o.label.languages.length
  languagesFound += o.label.languages.length - languageMisses.length
  const years = o.requirements.experience?.minYears ?? null
  if (years === o.label.minYears) yearsMatched++

  const problems = [
    o.error ? `extraction failed: ${o.error}` : null,
    missed.length ? `missed required: ${missed.join('; ')}` : null,
    demoted.length ? `required read as preferred: ${demoted.join('; ')}` : null,
    unlabeled.length ? `not in labels: ${unlabeled.join(', ')}` : null,
    years !== o.label.minYears ? `years: label ${o.label.minYears ?? 'none'}, extracted ${years ?? 'none'}` : null,
    languageMisses.length ? `missed languages: ${languageMisses.map((l) => l.language).join(', ')}` : null,
    o.stripped ? `${o.stripped} quote(s) not found in the posting` : null,
  ].filter((p) => p !== null)
  if (problems.length > 0) details.push(`- ${o.label.caseId}\n${problems.map((p) => `    ${p}`).join('\n')}`)
}

const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`)
const quoteRate = quoted === 0 ? 1 : (quoted - stripped) / quoted
const requiredRecall = requiredGroups === 0 ? 1 : requiredFound / requiredGroups
const passes = { quoteRate: quoteRate >= TARGETS.quoteRate, requiredRecall: requiredRecall >= TARGETS.requiredRecall }
const cost = Object.values(cache).reduce((s, e) => s + e.costMicroUsd, 0) / 1e6

say(`Matching eval: ${outcomes.length} postings, prompt ${extractRequirementsTask.name}@${extractRequirementsTask.version}`)
say(`Model calls this run: ${modelCalls} (cached extractions cost $${cost.toFixed(4)} in total)`)
say()
say('| Metric | Value | Target | |')
say('| --- | --- | --- | --- |')
say(`| Quote validation rate | ${pct(quoted - stripped, quoted)} (${quoted - stripped}/${quoted}) | ≥ ${pct(TARGETS.quoteRate, 1)} | ${passes.quoteRate ? 'PASS' : 'FAIL'} |`)
say(`| Required skills found | ${pct(requiredFound, requiredGroups)} (${requiredFound}/${requiredGroups}) | ≥ ${pct(TARGETS.requiredRecall, 1)} | ${passes.requiredRecall ? 'PASS' : 'FAIL'} |`)
say(`| …of those, read as required | ${pct(requiredAsRequired, requiredFound)} (${requiredAsRequired}/${requiredFound}) | report | |`)
say(`| Preferred skills found | ${pct(preferredFound, preferredGroups)} (${preferredFound}/${preferredGroups}) | report | |`)
say(`| Extracted skills a label allows | ${pct(allowedSkills, extractedSkills)} (${allowedSkills}/${extractedSkills}) | report | |`)
say(`| Overall years exactly right | ${pct(yearsMatched, outcomes.length)} (${yearsMatched}/${outcomes.length}) | report | |`)
say(`| Languages found | ${pct(languagesFound, languagesLabeled)} (${languagesFound}/${languagesLabeled}) | report | |`)
say()
say(`Postings with something to look at: ${details.length}`)
for (const detail of details) say(detail)

const report = lines.join('\n')
console.log(report)
writeFileSync('evals/.cache/last-matching-report.md', report + '\n')
if (!Object.values(passes).every(Boolean)) process.exitCode = 1
