import { defineQueue } from '@/lib/queue'
import { extractResumeTask } from './prompts/extract-resume.js'
import { ResumeParsePayloadSchema } from './types.js'

/**
 * Parses one resume version into draft career items (handler: runResumeParse).
 * Enqueued after an upload; the key is per task version, so a duplicate upload
 * event is dropped while a new prompt version still gets its own run.
 */
export const resumeParseQueue = defineQueue('resume-parse', ResumeParsePayloadSchema)

export function resumeParseKey(resumeId: string, retryNonce?: string): string {
  const base = `${resumeId}@v${extractResumeTask.version}`
  return retryNonce === undefined ? base : `${base}@retry-${retryNonce}`
}
