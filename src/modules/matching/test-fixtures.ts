import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Db } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { ok, unwrap } from '@/lib/result'
import type { ModelTrace } from '@/modules/ai'
import { recordDrafts, type CareerItemDraft } from '@/modules/career-knowledge'
import { assessJobForUser, UNSPECIFIED_CLAIMS, type EligibilityClaims, type ExtractClaims } from '@/modules/eligibility'
import { addSource, pollSourcePage, type JobSource } from '@/modules/job-sources'
import { upsertJobFromRaw, type Job } from '@/modules/jobs'
import { ensureUser, saveCandidateProfile, type CandidateProfileInput } from '@/modules/profiles'
import { startParse, uploadResume } from '@/modules/resumes'
import type { ExtractRequirements } from './extract.js'
import { NO_REQUIREMENTS, type JobRequirements } from './types.js'

/*
 * Jobs, candidates, career records and eligibility verdicts, all built through each
 * module's public interface. Nothing here writes another module's tables directly.
 */

let nextPostingId = 8_000_000

export type Posting = { readonly id: number; readonly title: string; readonly content: string; readonly location: string }

export const aPosting = (overrides: Partial<Posting> = {}): Posting => ({
  id: nextPostingId++,
  title: 'Senior Backend Engineer',
  content: '&lt;p&gt;Remote across LATAM. You have 5+ years with TypeScript. Kubernetes is a plus.&lt;/p&gt;',
  location: 'Remote - LATAM',
  ...overrides,
})

export async function aBoard(db: Db): Promise<JobSource> {
  return unwrap(await addSource(db, { adapterKey: 'greenhouse', name: `Globex ${randomUUID()}`, token: randomUUID() }, async () => Response.json({ name: 'Globex' })))
}

/** Polls the board listing exactly this posting and normalizes it into its job. */
export async function publish(db: Db, board: JobSource, posting: Posting): Promise<Job> {
  const payload = {
    id: posting.id, title: posting.title, content: posting.content, location: { name: posting.location },
    absolute_url: `https://boards.example.com/globex/jobs/${posting.id}`, first_published: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
  }
  const page = unwrap(await pollSourcePage(
    db,
    { sourceId: board.id, pollId: 'test', cursor: null, startedAt: new Date() },
    { fetcher: async () => Response.json({ jobs: [payload] }), enqueueNextPage: async () => ok(undefined) },
  ))
  if (page.kind !== 'page' || !page.postings[0]) throw new Error('expected one captured posting')
  return unwrap(await upsertJobFromRaw(db, page.postings[0].rawJobId))
}

export const seeker: CandidateProfileInput = {
  country: 'SV', city: 'San Salvador', timezone: 'America/El_Salvador', workAuthorizations: [], willingToRelocate: false,
  allowedRegions: ['latam', 'worldwide'], employmentTypes: ['contractor'], salaryFloorMinor: null, salaryCurrency: 'USD',
  targetRoles: ['Senior Software Engineer'], seniority: 'senior', preferredTech: [], excludedTech: [], excludedCompanies: [], excludedIndustries: [],
  spokenLanguages: ['es', 'en'],
  constraintModes: {
    country: 'preferred', city: 'preferred', timezone: 'preferred', workAuthorizations: 'hard', willingToRelocate: 'hard',
    allowedRegions: 'hard', employmentTypes: 'preferred', salaryFloorMinor: 'preferred', salaryCurrency: 'preferred',
    targetRoles: 'preferred', seniority: 'preferred', preferredTech: 'preferred', excludedTech: 'preferred',
    excludedCompanies: 'preferred', excludedIndustries: 'preferred',
  },
}

export async function aCandidate(db: Db, profile: CandidateProfileInput = seeker): Promise<string> {
  const user = await ensureUser(db, { email: `match-${randomUUID()}@test.local` })
  await withTenant(db, user.id, async (scope) => unwrap(await saveCandidateProfile(scope, profile)))
  return user.id
}

const trace = (task: string, taskVersion: number): ModelTrace => ({
  task, taskVersion, provider: 'fake', model: 'fake-model', attempt: 1, stopReason: 'stop',
  inputTokens: 1200, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 900, latencyMs: 800,
  rawOutput: '{}', validationError: null,
})

const latam: EligibilityClaims = {
  ...UNSPECIFIED_CLAIMS,
  remoteScope: { kind: 'regions', regions: ['latam'], quote: 'Remote - LATAM' },
  onsite: { kind: 'remote', quote: 'Remote - LATAM' },
}
const emea: EligibilityClaims = { ...latam, remoteScope: { kind: 'regions', regions: ['emea'], quote: 'Remote - LATAM' } }

const READINGS = { open: latam, rejected: emea, silent: UNSPECIFIED_CLAIMS } as const

/** Runs eligibility for real, with a stand-in that reads the posting as open to the candidate, closed, or silent on where. */
export async function assessEligibility(db: Db, userId: string, jobId: string, reading: keyof typeof READINGS = 'open') {
  const extract: ExtractClaims = async () => ok({ value: READINGS[reading], traces: [trace('eligibility.extract-claims', 3)] })
  return unwrap(await assessJobForUser(db, { userId, jobId }, extract))
}

export const postingRequirements: JobRequirements = {
  ...NO_REQUIREMENTS,
  skills: [
    { name: 'TypeScript', importance: 'required', minYears: 5, quote: 'You have 5+ years with TypeScript.' },
    { name: 'Kubernetes', importance: 'preferred', minYears: null, quote: 'Kubernetes is a plus.' },
  ],
}

/** A model stand-in that counts its calls. */
export function stubExtract(requirements: JobRequirements = postingRequirements) {
  const calls: string[] = []
  const extract: ExtractRequirements = async (text) => {
    calls.push(text)
    return ok({ value: requirements, traces: [trace('matching.extract-requirements', 1)] })
  }
  return { extract, calls }
}

let resumePdf: Uint8Array | null = null

/** Career items as a resume parse would record them: uploaded through resumes, drafted through career-knowledge. */
export async function withCareerItems(db: Db, userId: string, drafts: readonly Partial<CareerItemDraft>[]): Promise<void> {
  resumePdf ??= await readFile(new URL('../resumes/__fixtures__/synthetic-resume.pdf', import.meta.url))
  const storageRoot = await mkdtemp(join(tmpdir(), 'match-test-'))
  const pdf = resumePdf
  await withTenant(db, userId, async (scope) => {
    const resume = unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot }))
    const started = unwrap(await startParse(scope, { resumeId: resume.id, task: 't', taskVersion: 1 }))
    if (started.kind !== 'started') throw new Error('expected a started run')
    await recordDrafts(scope, {
      sourceResumeId: resume.id, sourceParseId: started.parseId,
      drafts: drafts.map((draft) => ({
        type: 'role', organization: 'Initech', title: 'Software Engineer', startedOn: '2018-01', endedOn: '2024-01', isCurrent: false,
        summary: null, achievements: [], technologies: [], evidence: { achievements: [], technologies: [] }, ...draft,
      })),
    })
  })
}
