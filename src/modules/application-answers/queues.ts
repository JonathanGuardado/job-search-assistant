import { createHash } from 'node:crypto'
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

/** One candidate's drafting run (handler: draftAnswers, decision 0014); `only` drafts one question now, past the daily cap. */
export const answerDraftQueue = defineQueue('draft-answers', z.object({ userId: z.uuid(), only: z.string().min(1).optional() }))

/**
 * Producer for the answers page and the profile. Opening the page drafts at most every ten
 * minutes; a profile save drafts again at once, since it changes what drafts would say.
 */
export async function queueAnswerDrafts(redisUrl: string, userId: string, trigger: 'opened' | 'profile_saved', now: Date = new Date()): Promise<Result<void>> {
  const connection = connectRedis(redisUrl, 'producer')
  const queue = answerDraftQueue.open({ connection })
  connection.on('error', () => logEvent('application_answers.enqueue_failed', { userId }))
  const key = trigger === 'opened' ? `${userId}@${Math.floor(now.getTime() / BUCKET_MS)}` : `${userId}@profile@${now.getTime()}`
  try {
    await queue.enqueue({ userId }, key)
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'Drafts could not be refreshed right now.'))
  } finally {
    await queue.close()
    connection.disconnect()
  }
}

/**
 * Producer for "Draft now": drafts one question at once, for every job asking it, even past the
 * day's cap (decision 0014). Repeated presses within a minute run once.
 */
export async function queueDraftNow(redisUrl: string, userId: string, questionKey: string, now: Date = new Date()): Promise<Result<void>> {
  const connection = connectRedis(redisUrl, 'producer')
  const queue = answerDraftQueue.open({ connection })
  connection.on('error', () => logEvent('application_answers.enqueue_failed', { userId }))
  // Question keys can hold ':', which job ids may not.
  const question = createHash('sha256').update(questionKey).digest('hex').slice(0, 16)
  try {
    await queue.enqueue({ userId, only: questionKey }, `${userId}@now@${question}@${Math.floor(now.getTime() / 60_000)}`)
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'The draft could not be started right now.'))
  } finally {
    await queue.close()
    connection.disconnect()
  }
}
