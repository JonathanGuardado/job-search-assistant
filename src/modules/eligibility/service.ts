import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { withTenant, type TenantScope } from '@/lib/db/tenancy'
import { domainError, err, ok, type Result } from '@/lib/result'
import type { AiError } from '@/modules/ai'
import { getJob, listAssessableJobs, type Job } from '@/modules/jobs'
import { getCandidateProfile, listUserIds } from '@/modules/profiles'
import { assessEligibility } from './engine.js'
import type { ExtractClaims } from './extract.js'
import { eligibilityProfileOf } from './profile.js'
import { extractClaimsTask } from './prompts/extract-claims.js'
import { assessmentKey } from './queues.js'
import { eligibilityAssessments, jobEligibilityClaims } from './schema.js'
import {
  ENGINE_VERSION,
  UNSPECIFIED_CLAIMS,
  type AssessmentReasons,
  type EligibilityClaims,
  type EligibilityJob,
  type EligibilityProfile,
  type EligibilityVerdict,
  type Verdict,
} from './types.js'

export type Assessment = typeof eligibilityAssessments.$inferSelect

export type AssessmentOutcome =
  | { readonly kind: 'assessed'; readonly verdict: Verdict }
  /** The stored verdict already reflects this job text, profile and engine version. */
  | { readonly kind: 'fresh' }
  | { readonly kind: 'skipped'; readonly reason: 'no_profile' | 'job_not_assessable' }

function eligibilityJobOf(job: Job): EligibilityJob {
  const posted = job.salary.source === 'posted' ? job.salary : null
  return {
    id: job.id, title: job.title, locationText: job.locationText, description: job.description,
    locationPolicy: job.locationPolicy, locationCountry: job.locationCountry,
    salaryMinMinor: posted?.minMinor ?? null, salaryMaxMinor: posted?.maxMinor ?? null,
    salaryCurrency: posted?.currency ?? null, salarySource: job.salary.source,
  }
}

/** A digest of exactly what the rules read from the profile: a change anywhere else is not a reason to re-assess. */
export function profileHashOf(profile: EligibilityProfile): string {
  const { hardConstraints, ...fields } = profile
  return createHash('sha256').update(JSON.stringify({ ...fields, hardConstraints: [...hardConstraints].sort() })).digest('hex')
}

/** The candidate's current profile digest, or null without a profile. */
export async function currentProfileHash(db: Db, userId: string): Promise<string | null> {
  const profile = await withTenant(db, userId, (scope) => getCandidateProfile(scope))
  return profile ? profileHashOf(eligibilityProfileOf(profile)) : null
}

function reasonsOf(verdict: EligibilityVerdict): AssessmentReasons {
  if (verdict.verdict === 'not_eligible') return { ruleId: verdict.ruleId, reason: verdict.reason }
  if (verdict.verdict === 'needs_review') return { openQuestions: verdict.openQuestions }
  return {}
}

/** Thrown inside the engine's extract callback and caught below: a failed read must not become a verdict. */
class ExtractionFailed extends Error {
  constructor(readonly error: AiError) {
    super(error.message)
  }
}

type StoredClaims = { readonly id: string; readonly claims: EligibilityClaims; readonly model: string | null }

/** The posting's claims for this prompt version, reused unless the job's text changed since. */
async function claimsFor(db: Db, job: Job, text: string, extract: ExtractClaims): Promise<StoredClaims> {
  const [stored] = await db.select().from(jobEligibilityClaims)
    .where(and(eq(jobEligibilityClaims.jobId, job.id), eq(jobEligibilityClaims.taskVersion, extractClaimsTask.version)))
  if (stored && stored.jobFingerprint === job.fingerprint) return stored

  const extracted = await extract(text)
  if (!extracted.ok) throw new ExtractionFailed(extracted.error)
  const { value: claims, traces } = extracted.value
  const fields = {
    jobFingerprint: job.fingerprint, claims, traces: [...traces], model: traces.at(-1)?.model ?? null,
    costMicroUsd: traces.reduce((sum, t) => sum + t.costMicroUsd, 0),
  }
  const [row] = await db.insert(jobEligibilityClaims)
    .values({ jobId: job.id, taskVersion: extractClaimsTask.version, ...fields })
    .onConflictDoUpdate({ target: [jobEligibilityClaims.jobId, jobEligibilityClaims.taskVersion], set: { ...fields, extractedAt: sql`now()` } })
    .returning()
  if (!row) throw new Error('claims upsert returned no row')
  return row
}

/**
 * Assesses one job for one candidate and stores the verdict with its evidence.
 * Idempotent: an unchanged job, profile and engine version is a no-op, and a posting
 * is read by the model at most once per text version, whoever asks.
 *
 * `rate_limited` and `upstream_failed` mean nothing was written and the queue should
 * retry. A posting the model cannot read is stored as needs_review, never guessed.
 */
export async function assessJobForUser(
  db: Db,
  { userId, jobId }: { readonly userId: string; readonly jobId: string },
  extract: ExtractClaims,
): Promise<Result<AssessmentOutcome>> {
  const job = await getJob(db, jobId)
  if (!job.ok) return job
  // Closed postings and linked duplicates are not shown, so they are not assessed.
  if (job.value.closedAt !== null || job.value.canonicalJobId !== null) return ok({ kind: 'skipped', reason: 'job_not_assessable' })

  const profile = await withTenant(db, userId, (scope) => getCandidateProfile(scope))
  if (!profile) return ok({ kind: 'skipped', reason: 'no_profile' })
  const candidate = eligibilityProfileOf(profile)
  const profileHash = profileHashOf(candidate)

  const existing = await withTenant(db, userId, (scope) => getAssessment(scope, jobId))
  if (existing && existing.jobFingerprint === job.value.fingerprint && existing.profileHash === profileHash) return ok({ kind: 'fresh' })

  // Set by the extract callback when the engine reads the posting (stage 1 rejections never do).
  const read: { claims: StoredClaims | null } = { claims: null }
  let assessed: Awaited<ReturnType<typeof assessEligibility>>
  try {
    // Outside any transaction: a model call can take seconds.
    assessed = await assessEligibility(candidate, eligibilityJobOf(job.value), async (text) => {
      read.claims = await claimsFor(db, job.value, text, extract)
      return read.claims.claims
    })
  } catch (error) {
    if (!(error instanceof ExtractionFailed)) throw error
    const { code, message } = error.error
    if (code === 'rate_limited' || code === 'upstream_failed') return err(domainError(code, message))
    assessed = {
      verdict: { verdict: 'needs_review', confidence: 0, openQuestions: [`The posting could not be read automatically (${code}).`] },
      claims: UNSPECIFIED_CLAIMS,
      stage: 'partial',
    }
  }

  const { verdict, stage } = assessed
  const fields = {
    verdict: verdict.verdict, confidence: verdict.confidence, stage, reasons: reasonsOf(verdict),
    evidence: verdict.verdict === 'needs_review' ? [] : [...verdict.evidence],
    claimsId: read.claims?.id ?? null, promptVersion: read.claims ? extractClaimsTask.version : null, model: read.claims?.model ?? null,
    jobFingerprint: job.value.fingerprint, profileHash, assessedAt: new Date(),
  }
  await withTenant(db, userId, (scope) => scope.db.insert(eligibilityAssessments)
    .values({ userId, jobId, engineVersion: ENGINE_VERSION, ...fields })
    // The user's override is theirs: re-assessment replaces the engine's verdict, never theirs.
    .onConflictDoUpdate({ target: [eligibilityAssessments.userId, eligibilityAssessments.jobId, eligibilityAssessments.engineVersion], set: fields }))
  return ok({ kind: 'assessed', verdict: verdict.verdict })
}

type Enqueue = (payload: { readonly userId: string; readonly jobId: string }, key: string) => Promise<void>

/** Queues this job for every candidate with a profile. Run after a job is normalized. */
export async function enqueueAssessmentsForJob(db: Db, job: { readonly id: string; readonly fingerprint: string }, enqueue: Enqueue): Promise<number> {
  let queued = 0
  for (const userId of await listUserIds(db)) {
    const profileHash = await currentProfileHash(db, userId)
    if (profileHash === null) continue
    await enqueue({ userId, jobId: job.id }, assessmentKey(userId, job.id, job.fingerprint, profileHash))
    queued++
  }
  return queued
}

/** Queues every open job for one candidate. Run after their profile changes. */
export async function enqueueAssessmentsForUser(db: Db, userId: string, enqueue: Enqueue): Promise<number> {
  const profileHash = await currentProfileHash(db, userId)
  if (profileHash === null) return 0
  const jobs = await listAssessableJobs(db)
  for (const job of jobs) await enqueue({ userId, jobId: job.id }, assessmentKey(userId, job.id, job.fingerprint, profileHash))
  return jobs.length
}

/** Jobs the candidate's current verdict (theirs if they overrode it) does not reject: what matching compares. */
export async function listJobIdsNotRejected(scope: TenantScope): Promise<string[]> {
  const rows = await scope.db.select({ jobId: eligibilityAssessments.jobId }).from(eligibilityAssessments)
    .where(and(eq(eligibilityAssessments.engineVersion, ENGINE_VERSION), sql`coalesce(${eligibilityAssessments.userOverride}, ${eligibilityAssessments.verdict}) <> 'not_eligible'`))
  return rows.map((row) => row.jobId)
}

/** The verdict that counts: the user's override when they made one, else the engine's. */
export const effectiveVerdict = (assessment: Pick<Assessment, 'verdict' | 'userOverride'>): Verdict => assessment.userOverride ?? assessment.verdict

export async function getAssessment(scope: TenantScope, jobId: string): Promise<Assessment | null> {
  const [row] = await scope.db.select().from(eligibilityAssessments)
    .where(and(eq(eligibilityAssessments.jobId, jobId), eq(eligibilityAssessments.engineVersion, ENGINE_VERSION)))
  return row ?? null
}
