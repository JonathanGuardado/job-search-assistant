import { randomUUID } from 'node:crypto'
import type { Db } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { ok, unwrap } from '@/lib/result'
import type { ModelTrace } from '@/modules/ai'
import { addSource, pollSourcePage, type JobSource } from '@/modules/job-sources'
import { upsertJobFromRaw, type Job } from '@/modules/jobs'
import { ensureUser, saveCandidateProfile, type CandidateProfileInput } from '@/modules/profiles'
import type { ExtractClaims } from './extract.js'
import { UNSPECIFIED_CLAIMS, type EligibilityClaims } from './types.js'

/*
 * Jobs and candidates built through each module's public interface: a polled
 * Greenhouse board normalized into jobs, and a saved profile. Nothing here writes
 * another module's tables directly.
 */

let nextPostingId = 7_000_000

export type Posting = { readonly id: number; readonly title: string; readonly content: string; readonly location: string }

export const aPosting = (overrides: Partial<Posting> = {}): Posting => ({
  id: nextPostingId++,
  title: 'Senior Backend Engineer',
  content: '&lt;p&gt;This role is remote across LATAM.&lt;/p&gt;',
  location: 'Remote - LATAM',
  ...overrides,
})

export async function aBoard(db: Db): Promise<JobSource> {
  return unwrap(await addSource(db, { adapterKey: 'greenhouse', name: `Acme ${randomUUID()}`, token: randomUUID() }, async () => Response.json({ name: 'Acme' })))
}

/** Polls the board listing exactly this posting and normalizes it into its job. */
export async function publish(db: Db, board: JobSource, posting: Posting): Promise<Job> {
  const payload = {
    id: posting.id, title: posting.title, content: posting.content, location: { name: posting.location },
    absolute_url: `https://boards.example.com/acme/jobs/${posting.id}`, first_published: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
  }
  const page = unwrap(await pollSourcePage(
    db,
    { sourceId: board.id, pollId: 'test', cursor: null, startedAt: new Date() },
    { fetcher: async () => Response.json({ jobs: [payload] }), enqueueNextPage: async () => ok(undefined) },
  ))
  if (page.kind !== 'page' || !page.postings[0]) throw new Error('expected one captured posting')
  return unwrap(await upsertJobFromRaw(db, page.postings[0].rawJobId))
}

export const remoteSeeker: CandidateProfileInput = {
  country: 'SV', city: 'San Salvador', timezone: 'America/El_Salvador', workAuthorizations: [], willingToRelocate: false,
  allowedRegions: ['latam', 'worldwide'], employmentTypes: ['contractor'], salaryFloorMinor: null, salaryCurrency: 'USD',
  targetRoles: ['Engineer'], seniority: 'senior', preferredTech: [], excludedTech: [], excludedCompanies: [], excludedIndustries: [],
  constraintModes: {
    country: 'preferred', city: 'preferred', timezone: 'preferred', workAuthorizations: 'hard', willingToRelocate: 'hard',
    allowedRegions: 'hard', employmentTypes: 'preferred', salaryFloorMinor: 'preferred', salaryCurrency: 'preferred',
    targetRoles: 'preferred', seniority: 'preferred', preferredTech: 'preferred', excludedTech: 'preferred',
    excludedCompanies: 'preferred', excludedIndustries: 'preferred',
  },
}

export async function aCandidate(db: Db, profile: CandidateProfileInput | null = remoteSeeker): Promise<string> {
  const user = await ensureUser(db, { email: `candidate-${randomUUID()}@test.local` })
  if (profile) await withTenant(db, user.id, async (scope) => unwrap(await saveCandidateProfile(scope, profile)))
  return user.id
}

export const trace: ModelTrace = {
  task: 'eligibility.extract-claims', taskVersion: 3, provider: 'fake', model: 'fake-model', attempt: 1, stopReason: 'stop',
  inputTokens: 1200, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 900, latencyMs: 800,
  rawOutput: '{}', validationError: null,
}

export const latamClaims: EligibilityClaims = {
  ...UNSPECIFIED_CLAIMS,
  remoteScope: { kind: 'regions', regions: ['latam'], quote: 'This role is remote across LATAM.' },
  onsite: { kind: 'remote', quote: 'Remote - LATAM' },
}

/** A model stand-in that counts its calls. */
export function stubExtract(claims: EligibilityClaims = latamClaims) {
  const calls: string[] = []
  const extract: ExtractClaims = async (text) => {
    calls.push(text)
    return ok({ value: claims, traces: [trace] })
  }
  return { extract, calls }
}
