import { z } from 'zod'
import { connectRedis, defineQueue } from '@/lib/queue'
import { logEvent } from '@/lib/log'
import { domainError, err, ok, type Result } from '@/lib/result'

/**
 * One started fill (handler: runFill, decision 0016). Never retried and never re-run after a
 * stall: producers open it with one attempt and the worker with no stalled re-runs. The fill's
 * own status and lease are what stop a second browser; these only avoid trying.
 */
export const applicationFillQueue = defineQueue('application-fill', z.object({ userId: z.uuid(), fillId: z.uuid() }))

/** Producer for Start: the worker opens the browser within moments. Enqueuing the same fill twice is a no-op. */
export async function queueFill(redisUrl: string, userId: string, fillId: string): Promise<Result<void>> {
  const connection = connectRedis(redisUrl, 'producer')
  const queue = applicationFillQueue.open({ connection, attempts: 1 })
  connection.on('error', () => logEvent('automation.enqueue_failed', { userId, fillId }))
  try {
    await queue.enqueue({ userId, fillId }, `${userId}@fill@${fillId}`)
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'The fill could not be handed to the worker. Is `pnpm worker` running?'))
  } finally {
    await queue.close()
    connection.disconnect()
  }
}
