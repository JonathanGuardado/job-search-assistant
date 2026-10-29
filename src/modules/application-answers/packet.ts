import { createHash } from 'node:crypto'
import type { Db } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { domainError, err, ok, type Result } from '@/lib/result'
import { getApplicationForJob } from '@/modules/applications'
import { getStoredApplicationForm, postingKey } from '@/modules/job-sources'
import { getJobRawVersion } from '@/modules/jobs'
import { getResume } from '@/modules/resumes'
import type { FilledValue, QuestionAnswer } from './readiness.js'
import { candidateInputs, jobsToApplyTo, readinessFrom } from './service.js'

/*
 * The packet (decision 0016): everything the browser will enter for one job, built in code
 * from readiness, never by a model. The owner reviews it, and the fill enters exactly it.
 */

/** Where a saved answer came from: the owner's own words, a profile-fact draft, or a draft a model wrote. */
export type PacketOrigin = 'owner' | 'profile_draft' | 'written_draft'

/** Every item names its question's form fields, so the filler can tell the page's controls it expected from ones it did not. */
type Question = { readonly questionKey: string; readonly label: string; readonly fields: readonly string[] }

export type PacketItem =
  | Question & {
    readonly kind: 'fill'; readonly required: boolean
    /** The form field the value goes in. */
    readonly field: string
    readonly value: FilledValue
    readonly source: 'details' | 'resume' | 'profile' | 'saved'
    /** Set exactly when the source is a saved answer. */
    readonly origin: PacketOrigin | null
  }
  /** Required, and left for the owner to finish in the browser. */
  | Question & { readonly kind: 'unresolved'; readonly reason: NonNullable<QuestionAnswer['blocker']> }
  /** Optional, and left empty. */
  | Question & { readonly kind: 'empty' }

export type Packet = {
  readonly jobId: string
  /** The posting version reviewed: the application records it. */
  readonly rawJobId: string
  /** The stored form's payload, as read: a different payload makes the packet stale. */
  readonly formFingerprint: string
  /** The resume file the form's resume field gets, when it gets one. */
  readonly resume: { readonly id: string; readonly sha256: string } | null
  readonly items: readonly PacketItem[]
  /** Of everything above: a fill is tied to the packet the owner reviewed. */
  readonly fingerprint: string
}

/**
 * The packet for one job, or why the browser must not open for it: the job is not one the
 * candidate can apply to now (closed, hidden, applied to, not in "Can apply"), an application
 * for it exists, or no form is stored for it. Anything else is filled as far as possible, and
 * the rest is listed as the owner's to finish.
 */
export async function buildPacket(db: Db, userId: string, jobId: string): Promise<Result<Packet>> {
  const job = (await jobsToApplyTo(db, userId)).find((candidate) => candidate.id === jobId)
  if (!job) return err(domainError('invalid_input', 'This job is not one you can apply to now: it is closed, hidden, already applied to, or not in "Can apply".'))
  const stored = await getStoredApplicationForm(db, job)
  if (!stored) return err(domainError('not_found', 'No application form is stored for this job yet.'))

  const inputs = await candidateInputs(db, userId)
  const readiness = readinessFrom([job], new Map([[postingKey(job), stored]]), new Set(), inputs, new Map()).get(job.id)
  if (readiness?.kind !== 'assessed') throw new Error('a stored form must be assessed')
  const { applied, resume } = await withTenant(db, userId, async (scope) => {
    const file = readiness.readiness.answers.find((a) => a.value?.kind === 'file')?.value
    return {
      applied: await getApplicationForJob(scope, job.id),
      resume: file?.kind === 'file' ? await getResume(scope, file.resumeId) : null,
    }
  })
  if (applied) return err(domainError('invalid_input', 'You already applied to this job.'))
  if (resume && !resume.ok) return resume
  const rawJobId = await getJobRawVersion(db, job.id)
  if (!rawJobId.ok) return rawJobId

  // The answer readiness used: the job's own first, then the general one.
  const saved = [...(inputs.jobSaved.get(job.id) ?? []), ...inputs.saved]
  const originOf = (key: string): PacketOrigin | null => {
    const answer = saved.find((s) => s.questionKey === key)
    return !answer ? null : answer.origin === 'owner' ? 'owner' : answer.written ? 'written_draft' : 'profile_draft'
  }
  const items = readiness.readiness.answers.flatMap((answer): PacketItem[] => {
    const { questionKey: key, question: { label, required } } = answer
    if (answer.source === 'form') return []
    const question = { questionKey: key, label, fields: answer.question.fields.map((f) => f.name) }
    if (answer.value !== null && answer.field !== null && answer.source !== 'none') {
      return [{ ...question, kind: 'fill', required, field: answer.field, value: answer.value, source: answer.source, origin: answer.source === 'saved' ? originOf(key) : null }]
    }
    return [answer.blocker !== null ? { ...question, kind: 'unresolved', reason: answer.blocker } : { ...question, kind: 'empty' }]
  })
  const pinned = {
    jobId: job.id, rawJobId: rawJobId.value, formFingerprint: stored.fingerprint,
    resume: resume ? { id: resume.value.id, sha256: resume.value.contentSha256 } : null, items,
  }
  return ok({ ...pinned, fingerprint: createHash('sha256').update(JSON.stringify(pinned)).digest('hex') })
}
