import { z } from 'zod'
import type { Db } from '@/lib/db/client'
import { withTenant, type TenantScope } from '@/lib/db/tenancy'
import { logEvent } from '@/lib/log'
import { domainError, err, ok, type Result } from '@/lib/result'
import { callModel, type AiError, type CallModelSuccess } from '@/modules/ai'
import {
  completeParse,
  failParse,
  getLatestParse,
  PARSE_LEASE_MS,
  renewParseLease,
  startParse,
  type ParseAttempt,
  type ResumeParse,
} from '@/modules/resumes'
import { extractResumeTask } from './prompts/extract-resume.js'
import { sanitizeExtractedResume } from './sanitize.js'
import { recordDrafts } from './service.js'
import {
  ExtractedResumeSchema,
  RejectedValueSchema,
  type ExtractedResume,
  type RejectedValue,
  type ResumeParsePayload,
} from './types.js'

/** What this task stores on the resume_parses row; the model's raw output is in the traces. */
const ParseResultSchema = z.object({
  draftCount: z.number().int().nonnegative(),
  rejected: z.array(RejectedValueSchema),
})

/** The model call, injectable so tests stub it rather than the provider. */
export type ExtractCareerItems = (
  text: string,
) => Promise<Result<CallModelSuccess<ExtractedResume>, AiError>>

export const extractWithModel: ExtractCareerItems = (text) =>
  callModel({ task: extractResumeTask, schema: ExtractedResumeSchema, input: { text } })

export type ParseLease = { readonly leaseMs: number; readonly renewEveryMs: number }

// Renewing at a fifth of the lease survives several missed renewals before the run is reclaimed.
const DEFAULT_LEASE: ParseLease = { leaseMs: PARSE_LEASE_MS, renewEveryMs: PARSE_LEASE_MS / 5 }

/**
 * Renews the lease until the returned stop function is called. Renewals are chained
 * so they never overlap, and stopping waits for the last one to settle. A lost lease
 * is only logged: the model call cannot be cancelled, and completion will refuse it.
 */
function keepLeaseAlive(db: Db, userId: string, attempt: ParseAttempt, lease: ParseLease): () => Promise<void> {
  let renewal: Promise<void> = Promise.resolve()
  const timer = setInterval(() => {
    renewal = renewal
      .then(() => withTenant(db, userId, (scope) => renewParseLease(scope, { ...attempt, leaseMs: lease.leaseMs })))
      .then(
        (renewed) => {
          if (!renewed.ok) logEvent('resume.parse_lease_lost', { parseId: attempt.parseId })
        },
        (error: unknown) =>
          logEvent('resume.parse_lease_renew_failed', {
            parseId: attempt.parseId,
            error: error instanceof Error ? error.message : String(error),
          }),
      )
  }, lease.renewEveryMs)
  return async () => {
    clearInterval(timer)
    await renewal
  }
}

/**
 * The `resume-parse` job: resume text → model → verbatim check → draft items.
 * Idempotent: a succeeded run is not repeated, a run another worker holds is left
 * to it, and drafts are written in the same transaction that marks the run
 * succeeded, so neither a retry nor an overlapping job can duplicate them.
 */
export async function runResumeParse(
  db: Db,
  { userId, resumeId }: ResumeParsePayload,
  extract: ExtractCareerItems = extractWithModel,
  lease: ParseLease = DEFAULT_LEASE,
): Promise<Result<void>> {
  const started = await withTenant(db, userId, (scope) =>
    startParse(scope, {
      resumeId,
      task: extractResumeTask.name,
      taskVersion: extractResumeTask.version,
      leaseMs: lease.leaseMs,
    }),
  )
  if (!started.ok) return started
  // If the holder dies, its lease lapses and the run shows as stalled, which the user can retry.
  if (started.value.kind !== 'started') return ok(undefined)
  const { parseId, attemptId, resume } = started.value
  const run: ParseAttempt = { parseId, attemptId }

  // Outside any transaction: a model call can take minutes, and holding a pooled
  // connection that long starves everything else.
  const stopRenewing = keepLeaseAlive(db, userId, run, lease)
  let extracted: Awaited<ReturnType<ExtractCareerItems>>
  try {
    extracted = await extract(resume.extractedText)
  } catch (error) {
    await stopRenewing()
    // A bug or misconfiguration (e.g. no API key). Record it so the run never
    // looks in progress forever, then let the worker edge surface it.
    const errorMessage = error instanceof Error ? error.message : String(error)
    await withTenant(db, userId, (scope) =>
      failParse(scope, { ...run, errorCode: 'internal_error', errorMessage, traces: [] }),
    )
    throw error
  }
  await stopRenewing()

  if (!extracted.ok) {
    const { code, message, traces } = extracted.error
    await withTenant(db, userId, (scope) =>
      failParse(scope, { ...run, errorCode: code, errorMessage: message, traces }),
    )
    // Only an outage or a quota is worth retrying; refusals, truncation and bad output would repeat.
    return code === 'upstream_failed' || code === 'rate_limited' ? err(domainError(code, message)) : ok(undefined)
  }

  const { drafts, rejected } = sanitizeExtractedResume(extracted.value.value, resume.extractedText)
  await withTenant(db, userId, async (scope) => {
    const completed = await completeParse(scope, {
      ...run,
      result: { draftCount: drafts.length, rejected },
      traces: extracted.value.traces,
    })
    // `conflict`: this attempt lost its lease, and the attempt that replaced it owns the result.
    if (completed.ok) await recordDrafts(scope, { sourceResumeId: resumeId, sourceParseId: run.parseId, drafts })
    else logEvent('resume.parse_result_discarded', { parseId: run.parseId })
  })
  return ok(undefined)
}

export type ParseReport = {
  readonly parse: ResumeParse | null
  /** Values the model proposed that were not found in the resume. */
  readonly rejected: readonly RejectedValue[]
}

/** The latest parse of a resume, with its rejected values decoded from the stored result. */
export async function getParseReport(scope: TenantScope, resumeId: string): Promise<ParseReport> {
  const parse = await getLatestParse(scope, resumeId)
  if (parse === null || parse.status !== 'succeeded') return { parse, rejected: [] }
  // jsonb read back from the database: parse it at this boundary rather than trusting its shape.
  const result = ParseResultSchema.safeParse(parse.result)
  return { parse, rejected: result.success ? result.data.rejected : [] }
}
