import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { withTenant, type TenantScope } from '@/lib/db/tenancy'
import { domainError, err, ok, type Result } from '@/lib/result'
import type { AiError } from '@/modules/ai'
import { listCareerItems } from '@/modules/career-knowledge'
import { effectiveVerdict, getAssessment, listJobIdsNotRejected } from '@/modules/eligibility'
import { getJob, listAssessableJobs, type Job } from '@/modules/jobs'
import { getCandidateProfile } from '@/modules/profiles'
import { compareRequirements, type MatchCandidate } from './compare.js'
import { explainMatch, type CardSection } from './explain.js'
import { postingText, validateRequirements, type ExtractRequirements } from './extract.js'
import { extractRequirementsTask } from './prompts/extract-requirements.js'
import { matchKey } from './queues.js'
import { jobRequirements, matchAssessments } from './schema.js'
import { MATCH_ENGINE_VERSION, type JobRequirements } from './types.js'

export type Match = typeof matchAssessments.$inferSelect

export type MatchOutcome =
  | { readonly kind: 'assessed' }
  /** The stored match already reflects this job text, candidate record and engine version. */
  | { readonly kind: 'fresh' }
  | { readonly kind: 'skipped'; readonly reason: 'no_profile' | 'job_not_assessable' | 'not_assessed' | 'not_eligible' }

/** Everything the comparison reads about the candidate. */
async function candidateOf(scope: TenantScope): Promise<MatchCandidate | null> {
  const profile = await getCandidateProfile(scope)
  if (!profile) return null
  return { profile, careerItems: await listCareerItems(scope) }
}

/** A digest of exactly what the comparison reads: a change anywhere else is not a reason to re-match. */
export function inputsHashOf({ profile, careerItems }: MatchCandidate): string {
  const { targetRoles, seniority, preferredTech, excludedTech, excludedCompanies, employmentTypes, salaryFloorMinor, salaryCurrency, spokenLanguages } = profile
  const items = [...careerItems].sort((a, b) => a.id.localeCompare(b.id)).map((item) => [
    item.id, item.type, item.title, item.organization, item.startedOn, item.endedOn, item.isCurrent, item.summary, item.achievements, item.technologies, item.verifiedByUser,
  ])
  return createHash('sha256').update(JSON.stringify({
    targetRoles, seniority, preferredTech, excludedTech, excludedCompanies, employmentTypes, salaryFloorMinor, salaryCurrency, spokenLanguages, items,
  })).digest('hex')
}

type StoredRequirements = { readonly id: string; readonly requirements: JobRequirements; readonly model: string | null }

/** Thrown inside requirementsFor and caught below: a failed read must not become a comparison of nothing. */
class ExtractionFailed extends Error {
  constructor(readonly error: AiError) {
    super(error.message)
  }
}

/** The posting's requirements for this prompt version, reused unless the job's text changed since. */
async function requirementsFor(db: Db, job: Job, extract: ExtractRequirements): Promise<StoredRequirements> {
  const [stored] = await db.select().from(jobRequirements)
    .where(and(eq(jobRequirements.jobId, job.id), eq(jobRequirements.taskVersion, extractRequirementsTask.version)))
  if (stored && stored.jobFingerprint === job.fingerprint) return stored

  const extracted = await extract(postingText(job))
  if (!extracted.ok) throw new ExtractionFailed(extracted.error)
  const { value: requirements, traces } = extracted.value
  const fields = {
    jobFingerprint: job.fingerprint, requirements, traces: [...traces], model: traces.at(-1)?.model ?? null,
    costMicroUsd: traces.reduce((sum, t) => sum + t.costMicroUsd, 0),
  }
  const [row] = await db.insert(jobRequirements)
    .values({ jobId: job.id, taskVersion: extractRequirementsTask.version, ...fields })
    .onConflictDoUpdate({ target: [jobRequirements.jobId, jobRequirements.taskVersion], set: { ...fields, extractedAt: sql`now()` } })
    .returning()
  if (!row) throw new Error('requirements upsert returned no row')
  return row
}

/**
 * Compares one job eligibility did not reject with one candidate's record, and stores the
 * result with its evidence. Idempotent: an unchanged job, candidate record and engine
 * version is a no-op, and a posting is read by the model at most once per text version.
 *
 * `rate_limited` and `upstream_failed` mean nothing was written and the queue should
 * retry. A posting the model cannot read is still compared on its structured fields, with
 * the text-based dimensions unknown.
 */
export async function assessMatchForUser(
  db: Db,
  { userId, jobId }: { readonly userId: string; readonly jobId: string },
  extract: ExtractRequirements,
  today: Date = new Date(),
): Promise<Result<MatchOutcome>> {
  const job = await getJob(db, jobId)
  if (!job.ok) return job
  if (job.value.closedAt !== null || job.value.canonicalJobId !== null) return ok({ kind: 'skipped', reason: 'job_not_assessable' })

  const read = await withTenant(db, userId, async (scope) => {
    const eligibility = await getAssessment(scope, jobId)
    const candidate = await candidateOf(scope)
    const existing = await getMatch(scope, jobId)
    return { eligibility, candidate, existing }
  })
  if (!read.candidate) return ok({ kind: 'skipped', reason: 'no_profile' })
  if (!read.eligibility) return ok({ kind: 'skipped', reason: 'not_assessed' })
  if (effectiveVerdict(read.eligibility) === 'not_eligible') return ok({ kind: 'skipped', reason: 'not_eligible' })
  const inputsHash = inputsHashOf(read.candidate)
  if (read.existing && read.existing.jobFingerprint === job.value.fingerprint && read.existing.inputsHash === inputsHash) return ok({ kind: 'fresh' })

  let stored: StoredRequirements | null = null
  try {
    // Outside any transaction: a model call can take seconds.
    stored = await requirementsFor(db, job.value, extract)
  } catch (error) {
    if (!(error instanceof ExtractionFailed)) throw error
    const { code, message } = error.error
    if (code === 'rate_limited' || code === 'upstream_failed') return err(domainError(code, message))
  }

  const requirements = stored ? validateRequirements(stored.requirements, postingText(job.value)).requirements : null
  const result = compareRequirements(job.value, requirements, read.candidate, today)
  const fields = {
    dimensions: result.dimensions, metRequirements: [...result.met], missingRequirements: [...result.missing], concerns: [...result.concerns],
    salaryCompatibility: result.salaryCompatibility, requirementsId: stored?.id ?? null,
    promptVersion: stored ? extractRequirementsTask.version : null, model: stored?.model ?? null,
    jobFingerprint: job.value.fingerprint, inputsHash, assessedAt: today,
  }
  await withTenant(db, userId, (scope) => scope.db.insert(matchAssessments)
    .values({ userId, jobId, engineVersion: MATCH_ENGINE_VERSION, ...fields })
    .onConflictDoUpdate({ target: [matchAssessments.userId, matchAssessments.jobId, matchAssessments.engineVersion], set: fields }))
  return ok({ kind: 'assessed' })
}

export async function getMatch(scope: TenantScope, jobId: string): Promise<Match | null> {
  const [row] = await scope.db.select().from(matchAssessments)
    .where(and(eq(matchAssessments.jobId, jobId), eq(matchAssessments.engineVersion, MATCH_ENGINE_VERSION)))
  return row ?? null
}

/**
 * What a job card shows: the stored match as headline-and-evidence sections, plus the
 * posting's requirements that were not compared. Null when the job has not been matched.
 */
export async function getMatchCard(db: Db, userId: string, jobId: string): Promise<{ readonly match: Match; readonly sections: CardSection[] } | null> {
  const match = await withTenant(db, userId, (scope) => getMatch(scope, jobId))
  if (!match) return null
  const job = await getJob(db, jobId)
  let notCompared: JobRequirements['other'] = []
  if (match.requirementsId !== null && job.ok) {
    const [row] = await db.select({ requirements: jobRequirements.requirements }).from(jobRequirements).where(eq(jobRequirements.id, match.requirementsId))
    if (row) notCompared = validateRequirements(row.requirements, postingText(job.value)).requirements.other
  }
  const result = {
    dimensions: match.dimensions, salaryCompatibility: match.salaryCompatibility,
    met: match.metRequirements, missing: match.missingRequirements, concerns: match.concerns,
  }
  return { match, sections: explainMatch(result, notCompared) }
}

type Enqueue = (payload: { readonly userId: string; readonly jobId: string }, key: string) => Promise<void>

async function currentInputsHash(db: Db, userId: string): Promise<string | null> {
  const candidate = await withTenant(db, userId, candidateOf)
  return candidate ? inputsHashOf(candidate) : null
}

/** Queues one match. Run after eligibility assesses a job without rejecting it. */
export async function enqueueMatch(db: Db, { userId, jobId }: { readonly userId: string; readonly jobId: string }, enqueue: Enqueue): Promise<boolean> {
  const job = await getJob(db, jobId)
  const inputsHash = await currentInputsHash(db, userId)
  if (!job.ok || inputsHash === null) return false
  await enqueue({ userId, jobId }, matchKey(userId, jobId, job.value.fingerprint, inputsHash))
  return true
}

/** Queues a match of every open job not rejected for one candidate. Run after their profile or career record changes. */
export async function enqueueMatchesForUser(db: Db, userId: string, enqueue: Enqueue): Promise<number> {
  const inputsHash = await currentInputsHash(db, userId)
  if (inputsHash === null) return 0
  const notRejected = new Set(await withTenant(db, userId, listJobIdsNotRejected))
  const jobs = (await listAssessableJobs(db)).filter((job) => notRejected.has(job.id))
  for (const job of jobs) await enqueue({ userId, jobId: job.id }, matchKey(userId, job.id, job.fingerprint, inputsHash))
  return jobs.length
}
