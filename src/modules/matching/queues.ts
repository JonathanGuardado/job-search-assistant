import { z } from 'zod'
import { connectRedis, defineQueue } from '@/lib/queue'
import { logEvent } from '@/lib/log'
import { domainError, err, ok, type Result } from '@/lib/result'
import { extractRequirementsTask } from './prompts/extract-requirements.js'
import { MATCH_ENGINE_VERSION } from './types.js'

/**
 * One candidate × one job eligibility did not reject (handler: assessMatchForUser). The key
 * carries the job's text version and the digest of everything matching reads about the
 * candidate, so a changed posting, profile or career record is queued anew.
 */
export const assessMatchQueue = defineQueue('assess-match', z.object({ userId: z.uuid(), jobId: z.uuid() }))

export const matchKey = (userId: string, jobId: string, jobFingerprint: string, inputsHash: string): string =>
  `${userId}@${jobId}@${jobFingerprint.slice(0, 16)}@${inputsHash.slice(0, 16)}@m${MATCH_ENGINE_VERSION}p${extractRequirementsTask.version}`

/** After a profile save or a career-record edit: queue a match of every job not rejected for that candidate. */
export const rematchUserQueue = defineQueue('match-reassess-user', z.object({ userId: z.uuid() }))

/** Producer for the settings and resume pages. A failure leaves the saved change in place. */
export async function enqueueRematchUser(redisUrl: string, userId: string): Promise<Result<void>> {
  const connection = connectRedis(redisUrl, 'producer')
  const queue = rematchUserQueue.open({ connection })
  const logFailure = () => logEvent('matching.enqueue_failed', { userId })
  connection.on('error', logFailure)
  queue.queue.on('error', logFailure)
  try {
    // Keyed by time: every change re-checks, and the per-job keys drop work already done.
    await queue.enqueue({ userId }, `${userId}@${Date.now()}`)
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'Your change is saved, but re-matching your jobs could not be queued.'))
  } finally {
    await queue.close()
    connection.disconnect()
  }
}
