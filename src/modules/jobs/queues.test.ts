import { randomUUID } from 'node:crypto'
import { QueueEvents, type Worker } from 'bullmq'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect } from 'vitest'
import { dbTest as test } from '@/lib/db/testing'
import { getEnv } from '@/lib/env'
import { connectRedis } from '@/lib/queue'
import { domainError, err, type DomainError, type Result } from '@/lib/result'
import { jobNormalizeKey, jobNormalizeQueue } from './queues.js'
import { jobs } from './schema.js'
import { upsertJobFromRaw } from './service.js'
import { aBoard, aPosting, poll } from './test-fixtures.js'
import type { JobNormalizePayload } from './types.js'

/**
 * Real Redis, real BullMQ, and the real handler writing through the test
 * transaction. Each test gets its own key prefix so runs never share state.
 */

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function harness(
  handler: (p: JobNormalizePayload) => Promise<Result<unknown, DomainError>>,
  overrides: { readonly attempts?: number; readonly rateLimitPauseMs?: number } = {},
) {
  const connection = connectRedis(getEnv().REDIS_URL)
  const eventsConnection = connectRedis(getEnv().REDIS_URL)
  const options = { connection, prefix: `test-${randomUUID()}`, attempts: 3, backoffMs: 10, ...overrides }
  const opened = jobNormalizeQueue.open(options)
  const worker: Worker = jobNormalizeQueue.work(options, handler)
  const events = new QueueEvents(jobNormalizeQueue.name, { connection: eventsConnection, prefix: options.prefix })
  cleanups.push(
    () => connection.quit(),
    () => eventsConnection.quit(),
    () => opened.close(),
    () => opened.queue.obliterate({ force: true }),
    () => events.close(),
    () => worker.close(),
  )
  // QueueEvents reads the event stream from when it connects; a job that finishes
  // before then is never reported, so wait for it before anything is enqueued.
  await events.waitUntilReady()
  return { ...opened, events }
}

describe('job-normalize queue', () => {
  test('a job that fails once is retried and writes the job', async ({ db }) => {
    const [posting] = (await poll(db, await aBoard(db), [aPosting()])).postings
    if (!posting) throw new Error('expected a captured posting')
    let calls = 0
    const q = await harness(async ({ rawJobId }) => {
      calls += 1
      if (calls === 1) return err(domainError('upstream_failed', 'transient'))
      return upsertJobFromRaw(db, rawJobId)
    })

    const queued = await q.enqueue({ rawJobId: posting.rawJobId }, jobNormalizeKey(posting.rawJobId))
    await queued.waitUntilFinished(q.events)

    expect(calls).toBe(2)
    expect(await db.select().from(jobs).where(eq(jobs.rawJobId, posting.rawJobId))).toHaveLength(1)
  })

  test('enqueuing the same raw version twice runs the work once', async ({ db }) => {
    const [posting] = (await poll(db, await aBoard(db), [aPosting()])).postings
    if (!posting) throw new Error('expected a captured posting')
    let calls = 0
    const q = await harness(async ({ rawJobId }) => {
      calls += 1
      return upsertJobFromRaw(db, rawJobId)
    })

    const first = await q.enqueue({ rawJobId: posting.rawJobId }, jobNormalizeKey(posting.rawJobId))
    const second = await q.enqueue({ rawJobId: posting.rawJobId }, jobNormalizeKey(posting.rawJobId))
    expect(second.id).toBe(first.id)

    await first.waitUntilFinished(q.events)
    expect(calls).toBe(1)
  })

  test('a rate-limited job pauses the worker and runs again without spending an attempt', async () => {
    let calls = 0
    const q = await harness(async () => {
      calls += 1
      return calls === 1 ? err(domainError('rate_limited', 'quota')) : err(domainError('not_found', 'done'))
    }, { attempts: 1, rateLimitPauseMs: 50 })

    const id = randomUUID()
    const queued = await q.enqueue({ rawJobId: id }, jobNormalizeKey(id))
    // With one attempt, a counted retry would have failed for good on the rate limit.
    await expect(queued.waitUntilFinished(q.events)).rejects.toThrow('not_found')
    expect(calls).toBe(2)
  })

  test('a permanent failure is not retried', async () => {
    let calls = 0
    const q = await harness(async () => {
      calls += 1
      return err(domainError('not_found', 'raw job missing'))
    })

    const missing = randomUUID()
    const queued = await q.enqueue({ rawJobId: missing }, jobNormalizeKey(missing))
    await expect(queued.waitUntilFinished(q.events)).rejects.toThrow('not_found')
    expect(calls).toBe(1)
  })
})
