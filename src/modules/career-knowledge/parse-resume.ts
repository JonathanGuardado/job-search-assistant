import { z } from 'zod'
import type { Db } from '@/lib/db/client'
import { withTenant, type TenantScope } from '@/lib/db/tenancy'
import { domainError, err, ok, type Result } from '@/lib/result'
import { callModel, type AiError, type CallModelSuccess } from '@/modules/ai'
import { completeParse, failParse, getLatestParse, startParse, type ResumeParse } from '@/modules/resumes'
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

/**
 * The `resume-parse` job: resume text → model → verbatim check → draft items.
 * Idempotent: a succeeded run is not repeated, and drafts are written in the same
 * transaction that marks the run succeeded, so a retry cannot duplicate them.
 */
export async function runResumeParse(
  db: Db,
  { userId, resumeId }: ResumeParsePayload,
  extract: ExtractCareerItems = extractWithModel,
): Promise<Result<void>> {
  const started = await withTenant(db, userId, (scope) =>
    startParse(scope, { resumeId, task: extractResumeTask.name, taskVersion: extractResumeTask.version }),
  )
  if (!started.ok) return started
  if (started.value.kind === 'already_succeeded') return ok(undefined)
  const { parseId, resume } = started.value

  // Outside any transaction: a model call can take a minute, and holding a pooled
  // connection that long starves everything else.
  let extracted: Awaited<ReturnType<ExtractCareerItems>>
  try {
    extracted = await extract(resume.extractedText)
  } catch (error) {
    // A bug or misconfiguration (e.g. no API key). Record it so the run never
    // looks in progress forever, then let the worker edge surface it.
    const errorMessage = error instanceof Error ? error.message : String(error)
    await withTenant(db, userId, (scope) =>
      failParse(scope, { parseId, errorCode: 'internal_error', errorMessage, traces: [] }),
    )
    throw error
  }

  if (!extracted.ok) {
    const { code, message, traces } = extracted.error
    await withTenant(db, userId, (scope) =>
      failParse(scope, { parseId, errorCode: code, errorMessage: message, traces }),
    )
    // Only an outage is worth retrying; refusals, truncation and bad output would repeat.
    return code === 'upstream_failed' ? err(domainError('upstream_failed', message)) : ok(undefined)
  }

  const { drafts, rejected } = sanitizeExtractedResume(extracted.value.value, resume.extractedText)
  await withTenant(db, userId, async (scope) => {
    const completed = await completeParse(scope, {
      parseId,
      result: { draftCount: drafts.length, rejected },
      traces: extracted.value.traces,
    })
    // `conflict`: a concurrent run already finished and recorded its drafts.
    if (completed.ok) await recordDrafts(scope, { sourceResumeId: resumeId, sourceParseId: parseId, drafts })
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
