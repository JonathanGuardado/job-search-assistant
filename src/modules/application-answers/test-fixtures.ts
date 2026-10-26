import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Db } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { ok, unwrap } from '@/lib/result'
import type { ModelTrace } from '@/modules/ai'
import { assessJobForUser, UNSPECIFIED_CLAIMS, type EligibilityClaims, type ExtractClaims } from '@/modules/eligibility'
import { addSource, pollSourcePage, refreshApplicationForm, type AdapterKey, type JobSource } from '@/modules/job-sources'
import { upsertJobFromRaw, type Job } from '@/modules/jobs'
import { ensureUser, saveCandidateProfile, type CandidateProfileInput } from '@/modules/profiles'

/*
 * A candidate with a job they can apply to and its stored application form, built through
 * each module's public interface. Nothing here writes another module's tables directly.
 */

let nextPostingId = 9_500_000

export const formPayload = (name: 'canonical' | 'gitlab'): unknown =>
  JSON.parse(readFileSync(new URL(`../job-sources/__fixtures__/greenhouse-application-${name}.json`, import.meta.url), 'utf8'))

export async function aBoard(db: Db, adapterKey: AdapterKey = 'greenhouse'): Promise<JobSource> {
  return unwrap(await addSource(db, { adapterKey, name: `Umbrella ${randomUUID()}`, token: randomUUID() }, async () => Response.json(adapterKey === 'greenhouse' ? { name: 'Umbrella' } : [])))
}

export async function aJob(db: Db, board: JobSource, title = 'Software Engineer'): Promise<Job> {
  const id = nextPostingId++
  const payload = {
    id, title, content: '&lt;p&gt;Home based, worldwide.&lt;/p&gt;', location: { name: 'Home based - Worldwide' },
    absolute_url: `https://boards.example.com/umbrella/jobs/${id}`, first_published: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
  }
  const page = unwrap(await pollSourcePage(
    db, { sourceId: board.id, pollId: randomUUID(), cursor: null, startedAt: new Date() },
    { fetcher: async () => Response.json({ jobs: [payload] }), enqueueNextPage: async () => ok(undefined) },
  ))
  if (page.kind !== 'page' || !page.postings[0]) throw new Error('expected one posting')
  return unwrap(await upsertJobFromRaw(db, page.postings[0].rawJobId))
}

export async function storeForm(db: Db, job: Job, name: 'canonical' | 'gitlab'): Promise<void> {
  unwrap(await refreshApplicationForm(db, { sourceId: job.sourceId, externalId: job.externalId }, async () => Response.json(formPayload(name))))
}

const profile: CandidateProfileInput = {
  country: 'SV', city: 'San Salvador', timezone: 'America/El_Salvador', workAuthorizations: [], willingToRelocate: false,
  allowedRegions: ['latam', 'worldwide'], employmentTypes: ['contractor'], salaryFloorMinor: null, salaryCurrency: 'USD',
  targetRoles: ['Software Engineer'], seniority: 'senior', preferredTech: [], excludedTech: [], excludedCompanies: [], excludedIndustries: [],
  spokenLanguages: ['es', 'en'],
  constraintModes: {
    country: 'preferred', city: 'preferred', timezone: 'preferred', workAuthorizations: 'hard', willingToRelocate: 'hard',
    allowedRegions: 'hard', employmentTypes: 'preferred', salaryFloorMinor: 'preferred', salaryCurrency: 'preferred',
    targetRoles: 'preferred', seniority: 'preferred', preferredTech: 'preferred', excludedTech: 'preferred',
    excludedCompanies: 'preferred', excludedIndustries: 'preferred',
  },
}

export async function aCandidate(db: Db): Promise<string> {
  const user = await ensureUser(db, { email: `answers-${randomUUID()}@test.local` })
  await withTenant(db, user.id, async (scope) => unwrap(await saveCandidateProfile(scope, profile)))
  return user.id
}

const trace: ModelTrace = {
  task: 'eligibility.extract-claims', taskVersion: 3, provider: 'fake', model: 'fake-model', attempt: 1, stopReason: 'stop',
  inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 0, latencyMs: 1, rawOutput: '{}', validationError: null,
}
const worldwide: EligibilityClaims = { ...UNSPECIFIED_CLAIMS, remoteScope: { kind: 'worldwide', quote: 'Home based, worldwide.' }, onsite: { kind: 'remote', quote: 'Home based, worldwide.' } }

/** Runs eligibility for real, with a stand-in that reads the posting as open worldwide: the job lands in "Can apply". */
export async function makeEligible(db: Db, userId: string, job: Job): Promise<void> {
  const extract: ExtractClaims = async () => ok({ value: worldwide, traces: [trace] })
  const outcome = unwrap(await assessJobForUser(db, { userId, jobId: job.id }, extract))
  if (outcome.kind !== 'assessed' || outcome.verdict !== 'eligible') throw new Error(`expected eligible, got ${JSON.stringify(outcome)}`)
}
