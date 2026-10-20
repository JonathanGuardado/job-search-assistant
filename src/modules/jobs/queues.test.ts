import { randomUUID } from 'node:crypto'
import { QueueEvents, type Worker } from 'bullmq'
import { afterEach, describe, expect } from 'vitest'
import { dbTest as test } from '@/lib/db/testing'
import { getEnv } from '@/lib/env'
import { connectRedis } from '@/lib/queue'
import { domainError, err, unwrap, type DomainError, type Result } from '@/lib/result'
import { jobSeenQueue } from './queues.js'
import { getJob, insertJob, markJobSeen } from './service.js'
import { aNewJob } from './test-fixtures.js'
import type { JobSeenPayload } from './types.js'

/**
 * Real Redis, real BullMQ, and the real handler writing through the test
 * transaction. Each test gets its own key prefix so runs never share state.
 */

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function harness(handler: (p: JobSeenPayload) => Promise<Result<unknown, DomainError>>) {
  const connection = connectRedis(getEnv().REDIS_URL)
  const eventsConnection = connectRedis(getEnv().REDIS_URL)
  const options = { connection, prefix: `test-${randomUUID()}`, attempts: 3, backoffMs: 10 }
  const opened = jobSeenQueue.open(options)
  const worker: Worker = jobSeenQueue.work(options, handler)
  const events = new QueueEvents(jobSeenQueue.name, { connection: eventsConnection, prefix: options.prefix })
  cleanups.push(
    () => connection.quit(),
    () => eventsConnection.quit(),
    () => opened.close(),
    () => opened.queue.obliterate({ force: true }),
    () => events.close(),
    () => worker.close(),
  )
  return { ...opened, events }
}

describe('job-seen queue', () => {
  test('a job that fails once is retried and lands the correct state', async ({ db }) => {
    const job = await insertJob(db, aNewJob({ seenAt: new Date('2026-09-01T00:00:00Z') }))
    const seenAt = new Date('2026-09-10T00:00:00Z')
    let calls = 0
    const q = harness(async (payload) => {
      calls += 1
      if (calls === 1) return err(domainError('upstream_failed', 'transient'))
      return markJobSeen(db, payload)
    })

    const queued = await q.enqueue({ jobId: job.id, seenAt }, `${job.id}@${seenAt.getTime()}`)
    await queued.waitUntilFinished(q.events)

    expect(calls).toBe(2)
    expect(unwrap(await getJob(db, job.id)).lastSeenAt).toEqual(seenAt)
  })

  test('enqueuing the same key twice runs the work once', async ({ db }) => {
    const job = await insertJob(db, aNewJob())
    const seenAt = new Date('2026-09-10T00:00:00Z')
    let calls = 0
    const q = harness(async (payload) => {
      calls += 1
      return markJobSeen(db, payload)
    })

    const key = `${job.id}@${seenAt.getTime()}`
    const first = await q.enqueue({ jobId: job.id, seenAt }, key)
    const second = await q.enqueue({ jobId: job.id, seenAt }, key)
    expect(second.id).toBe(first.id)

    await first.waitUntilFinished(q.events)
    expect(calls).toBe(1)
  })

  test('a permanent failure is not retried', async ({ db }) => {
    let calls = 0
    const q = harness(async (payload) => {
      calls += 1
      return markJobSeen(db, payload)
    })

    const missing = randomUUID()
    const queued = await q.enqueue({ jobId: missing, seenAt: new Date() }, `${missing}@0`)
    await expect(queued.waitUntilFinished(q.events)).rejects.toThrow('not_found')
    expect(calls).toBe(1)
  })
})
