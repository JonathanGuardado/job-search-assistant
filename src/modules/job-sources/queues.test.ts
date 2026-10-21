import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getEnv } from '@/lib/env'
import { connectRedis } from '@/lib/queue'
import { DISPATCH_EVERY_MS, enqueueSourcePoll, POLL_INTERVAL_MS, sourcePollDispatchQueue, sourcePollKey, sourcePollQueue } from './queues.js'

const payload = () => ({ sourceId: randomUUID(), pollId: `w${Date.now()}`, cursor: null })

describe('source queue identities and scheduling', () => {
  it('keys by source, poll window and page without reserved colons', () => {
    const first = payload()
    expect(sourcePollKey(first)).toBe(`${first.sourceId}@${first.pollId}@first`)
    expect(sourcePollKey({ ...first, cursor: '100' })).toBe(`${first.sourceId}@${first.pollId}@100`)
    expect(sourcePollKey(first)).not.toContain(':')
    expect(POLL_INTERVAL_MS).toBe(6 * 60 * 60_000)
    expect(DISPATCH_EVERY_MS).toBe(15 * 60_000)
  })
  it('deduplicates overlapping dispatches and distinct page identities remain separate', async () => {
    const connection = connectRedis(getEnv().REDIS_URL)
    const queue = sourcePollQueue.open({ connection, prefix: `source-test-${randomUUID()}` })
    const entry = payload()
    try {
      await queue.enqueue(entry, sourcePollKey(entry))
      await queue.enqueue(entry, sourcePollKey(entry))
      const second = { ...entry, cursor: '100' }
      await queue.enqueue(second, sourcePollKey(second))
      expect(await queue.queue.getJobCounts('wait')).toMatchObject({ wait: 2 })
    } finally {
      await queue.queue.obliterate({ force: true })
      await queue.close()
      await connection.quit()
    }
  })
  it('upserts one recurring dispatch scheduler across restarts', async () => {
    const connection = connectRedis(getEnv().REDIS_URL)
    const queue = sourcePollDispatchQueue.open({ connection, prefix: `dispatch-test-${randomUUID()}` })
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await queue.queue.upsertJobScheduler('source-poll-dispatch', { every: DISPATCH_EVERY_MS }, { name: 'source-poll-dispatch', data: {} })
      }
      const schedulers = await queue.queue.getJobSchedulers()
      expect(schedulers).toHaveLength(1)
      expect(schedulers[0]).toMatchObject({ key: 'source-poll-dispatch', every: DISPATCH_EVERY_MS })
    } finally {
      await queue.queue.removeJobScheduler('source-poll-dispatch')
      await queue.queue.obliterate({ force: true })
      await queue.close()
      await connection.quit()
    }
  })
  it('returns a bounded producer failure when Redis cannot be reached', async () => {
    expect(await enqueueSourcePoll('redis://127.0.0.1:1', payload())).toMatchObject({ ok: false, error: { code: 'upstream_failed' } })
  }, 10_000)
})
