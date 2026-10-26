import { z } from 'zod'
import { connectRedis, defineQueue } from '@/lib/queue'
import { logEvent } from '@/lib/log'
import { domainError, err, ok, type Result } from '@/lib/result'
import { SourcePollPayloadSchema, type SourcePollPayload } from './types.js'

export const POLL_INTERVAL_MS = 6 * 60 * 60_000
export const DISPATCH_EVERY_MS = 15 * 60_000
export const sourcePollQueue = defineQueue('source-poll', SourcePollPayloadSchema)
export const sourcePollDispatchQueue = defineQueue('source-poll-dispatch', z.object({}))

export function sourcePollKey(payload: SourcePollPayload): string {
  return `${payload.sourceId}@${payload.pollId}@${payload.cursor ?? 'first'}`
}

export async function enqueueSourcePoll(redisUrl: string, payload: SourcePollPayload): Promise<Result<void>> {
  const connection = connectRedis(redisUrl, 'producer')
  const queue = sourcePollQueue.open({ connection })
  const logFailure = () => logEvent('source.enqueue_failed', { sourceId: payload.sourceId })
  connection.on('error', logFailure)
  queue.queue.on('error', logFailure)
  try {
    await queue.enqueue(payload, sourcePollKey(payload))
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'Could not queue this source. Try again when Redis is available.'))
  } finally {
    await queue.close()
    connection.disconnect()
  }
}

/**
 * One posting's application form (decision 0013). Keyed by the posting's raw version, so a
 * changed posting is fetched again and a repeat for the same version is dropped.
 */
export const applicationFormFetchQueue = defineQueue('application-form-fetch', z.object({ sourceId: z.uuid(), externalId: z.string().min(1) }))

export const applicationFormFetchKey = (posting: { readonly sourceId: string; readonly externalId: string }, rawJobId: string): string =>
  `${posting.sourceId}@${posting.externalId}@${rawJobId}`
