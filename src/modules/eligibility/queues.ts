import { z } from 'zod'
import { connectRedis, defineQueue } from '@/lib/queue'
import { logEvent } from '@/lib/log'
import { domainError, err, ok, type Result } from '@/lib/result'
import { ENGINE_VERSION } from './types.js'

/**
 * One candidate × one job (handler: assessJobForUser). The key carries the job's text
 * version and the candidate's profile digest, so a changed posting or profile is queued
 * anew while a repeat of the same inputs is dropped.
 */
export const assessEligibilityQueue = defineQueue('assess-eligibility', z.object({ userId: z.uuid(), jobId: z.uuid() }))

export const assessmentKey = (userId: string, jobId: string, jobFingerprint: string, profileHash: string): string =>
  `${userId}@${jobId}@${jobFingerprint.slice(0, 16)}@${profileHash.slice(0, 16)}@e${ENGINE_VERSION}`

/** After a profile save: queue an assessment of every open job for that candidate. */
export const reassessUserQueue = defineQueue('eligibility-reassess-user', z.object({ userId: z.uuid() }))

/** Producer for the settings page. A failure leaves the saved profile in place. */
export async function enqueueReassessUser(redisUrl: string, userId: string): Promise<Result<void>> {
  const connection = connectRedis(redisUrl, 'producer')
  const queue = reassessUserQueue.open({ connection })
  const logFailure = () => logEvent('eligibility.enqueue_failed', { userId })
  connection.on('error', logFailure)
  queue.queue.on('error', logFailure)
  try {
    // Keyed by time: every save re-checks, and the per-job keys drop work already done.
    await queue.enqueue({ userId }, `${userId}@${Date.now()}`)
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'Your profile is saved, but re-checking your jobs could not be queued.'))
  } finally {
    await queue.close()
    connection.disconnect()
  }
}
