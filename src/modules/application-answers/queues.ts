import { z } from 'zod'
import { connectRedis, defineQueue } from '@/lib/queue'
import { logEvent } from '@/lib/log'
import { domainError, err, ok, type Result } from '@/lib/result'

/** One candidate's "same question, different wording" run (handler: refreshQuestionMatches). */
export const questionMatchQueue = defineQueue('match-questions', z.object({ userId: z.uuid() }))

/** Runs at most once per ten minutes per candidate; the run itself is a no-op when nothing changed. */
const BUCKET_MS = 10 * 60_000

/** Producer for the answers page and saved-answer actions. A failure leaves what was saved in place. */
export async function queueQuestionMatch(redisUrl: string, userId: string, now: Date = new Date()): Promise<Result<void>> {
  const connection = connectRedis(redisUrl, 'producer')
  const queue = questionMatchQueue.open({ connection })
  connection.on('error', () => logEvent('application_answers.enqueue_failed', { userId }))
  try {
    await queue.enqueue({ userId }, `${userId}@${Math.floor(now.getTime() / BUCKET_MS)}`)
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'Your answer is saved, but suggestions could not be refreshed.'))
  } finally {
    await queue.close()
    connection.disconnect()
  }
}
