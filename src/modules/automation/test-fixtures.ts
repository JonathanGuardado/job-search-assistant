import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Db } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { ok, unwrap } from '@/lib/result'
import type { ModelTrace } from '@/modules/ai'
import { saveAnswer, saveApplicantDetails } from '@/modules/application-answers'
import { assessJobForUser, UNSPECIFIED_CLAIMS, type EligibilityClaims } from '@/modules/eligibility'
import { addSource, pollSourcePage, refreshApplicationForm } from '@/modules/job-sources'
import { upsertJobFromRaw, type Job } from '@/modules/jobs'
import { ensureUser, saveCandidateProfile, type CandidateProfileInput } from '@/modules/profiles'
import { uploadResume, type Resume } from '@/modules/resumes'

/*
 * A candidate with details, a resume and a GitLab job they can apply to, its form stored,
 * built through each module's public interface. Nothing here writes another module's tables.
 */

let nextPostingId = 9_700_000

/** The API form of the job whose page the tests replay (greenhouse-gitlab-page.har), so its fields match the page. */
const gitlabForm: unknown = JSON.parse(readFileSync(new URL('./__fixtures__/greenhouse-gitlab-form.json', import.meta.url), 'utf8'))
export const SPONSORSHIP = 'Will you now or in the future require sponsorship for a visa to remain in your current location?'
const AGREEMENTS = 'Are you subject to any employment agreements and/or post-employment restrictions with your current employer or a past employer?'

const profile: CandidateProfileInput = {
  country: 'SV', city: 'San Salvador', timezone: 'America/El_Salvador', workAuthorizations: [], willingToRelocate: false,
  allowedRegions: ['latam', 'worldwide'], employmentTypes: ['contractor'], salaryFloorMinor: null, salaryCurrency: 'USD',
  targetRoles: ['Software Engineer'], seniority: 'senior', preferredTech: [], excludedTech: [], excludedCompanies: [], excludedIndustries: [],
  spokenLanguages: ['es', 'en'], citizenships: [], englishLevel: null,
  constraintModes: {
    country: 'preferred', city: 'preferred', timezone: 'preferred', workAuthorizations: 'hard', willingToRelocate: 'hard',
    allowedRegions: 'hard', employmentTypes: 'preferred', salaryFloorMinor: 'preferred', salaryCurrency: 'preferred',
    targetRoles: 'preferred', seniority: 'preferred', preferredTech: 'preferred', excludedTech: 'preferred',
    excludedCompanies: 'preferred', excludedIndustries: 'preferred',
  },
}

const trace: ModelTrace = {
  task: 'eligibility.extract-claims', taskVersion: 3, provider: 'fake', model: 'fake-model', attempt: 1, stopReason: 'stop',
  inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 0, latencyMs: 1, rawOutput: '{}', validationError: null,
}
const worldwide: EligibilityClaims = { ...UNSPECIFIED_CLAIMS, remoteScope: { kind: 'worldwide', quote: 'Home based, worldwide.' }, onsite: { kind: 'remote', quote: 'Home based, worldwide.' } }

export type Applicant = { readonly userId: string; readonly job: Job; readonly resume: Resume; readonly storageRoot: string }

/** A candidate who could open a fill for a GitLab job right away, every required question answered. */
export async function anApplicant(db: Db): Promise<Applicant> {
  const user = await ensureUser(db, { email: `fill-${randomUUID()}@test.local` })
  const board = unwrap(await addSource(db, { adapterKey: 'greenhouse', name: `Umbrella ${randomUUID()}`, token: randomUUID() }, async () => Response.json({ name: 'Umbrella' })))
  const id = nextPostingId++
  const posting = {
    id, title: 'Backend Engineer', content: '&lt;p&gt;Home based, worldwide.&lt;/p&gt;', location: { name: 'Home based - Worldwide' },
    absolute_url: `https://boards.example.com/umbrella/jobs/${id}`, first_published: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
  }
  const page = unwrap(await pollSourcePage(
    db, { sourceId: board.id, pollId: randomUUID(), cursor: null, startedAt: new Date() },
    { fetcher: async () => Response.json({ jobs: [posting] }), enqueueNextPage: async () => ok(undefined) },
  ))
  if (page.kind !== 'page' || !page.postings[0]) throw new Error('expected one posting')
  const job = unwrap(await upsertJobFromRaw(db, page.postings[0].rawJobId))
  unwrap(await refreshApplicationForm(db, { sourceId: job.sourceId, externalId: job.externalId }, async () => Response.json(gitlabForm)))

  const pdf = await readFile(new URL('../resumes/__fixtures__/synthetic-resume.pdf', import.meta.url))
  const storageRoot = await mkdtemp(join(tmpdir(), 'automation-test-'))
  const resume = await withTenant(db, user.id, async (scope) => {
    unwrap(await saveCandidateProfile(scope, profile))
    unwrap(await saveApplicantDetails(scope, { firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.com', phone: '+503 7000 0000', linkedinUrl: null, githubUrl: null, websiteUrl: null }))
    for (const label of [SPONSORSHIP, AGREEMENTS]) unwrap(await saveAnswer(scope, { label, answer: { kind: 'choice', labels: ['No'] } }))
    return unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot }))
  })
  const outcome = unwrap(await assessJobForUser(db, { userId: user.id, jobId: job.id }, async () => ok({ value: worldwide, traces: [trace] })))
  if (outcome.kind !== 'assessed' || outcome.verdict !== 'eligible') throw new Error('expected eligible')
  return { userId: user.id, job, resume, storageRoot }
}

/** Changes what the packet would enter, so a reviewed packet goes stale. */
export async function changeAnAnswer(db: Db, userId: string, text = 'Yes'): Promise<void> {
  await withTenant(db, userId, async (scope) => unwrap(await saveAnswer(scope, { label: SPONSORSHIP, answer: { kind: 'choice', labels: [text] } })))
}
