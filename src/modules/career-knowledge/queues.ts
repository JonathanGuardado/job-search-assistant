import { connectRedis, defineQueue } from '@/lib/queue'
import { logEvent } from '@/lib/log'
import { domainError, err, ok, type Result } from '@/lib/result'
import { extractResumeTask } from './prompts/extract-resume.js'
import { ResumeParsePayloadSchema, type ResumeParsePayload } from './types.js'

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

export async function enqueueResumeParse(
  redisUrl: string,
  payload: ResumeParsePayload,
  key: string,
  prefix?: string,
): Promise<Result<void>> {
  const connection = connectRedis(redisUrl, 'producer')
  const queue = resumeParseQueue.open({ connection, ...(prefix === undefined ? {} : { prefix }) })
  // Redis emits errors as well as rejecting commands. Keep logs free of credentials.
  const logFailure = () => logEvent('resume.enqueue_failed', { resumeId: payload.resumeId })
  connection.on('error', logFailure)
  queue.queue.on('error', logFailure)
  try {
    await queue.enqueue(payload, key)
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'Your resume is saved, but reading could not be queued. Choose Start reading to try again.'))
  } finally {
    await queue.close()
    connection.disconnect()
  }
}
