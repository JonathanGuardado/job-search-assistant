import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getEnv } from '@/lib/env'
import { connectRedis } from '@/lib/queue'
import { enqueueResumeParse, resumeParseKey, resumeParseQueue } from './queues.js'

const payload = () => ({ userId: randomUUID(), resumeId: randomUUID() })

describe('resume dispatch recovery', () => {
  it('fails promptly when Redis is unavailable and tells the user how to recover', async () => {
    const result = await enqueueResumeParse('redis://127.0.0.1:1', payload(), randomUUID())
    expect(result).toMatchObject({ ok: false, error: { code: 'upstream_failed', message: expect.stringContaining('Your resume is saved') } })
    expect(!result.ok && result.error.message).toContain('Start reading')
  }, 10_000)

  it('reuses a pending upload key so repeated Start reading clicks enqueue once', async () => {
    const prefix = `resume-dispatch-${randomUUID()}`
    const entry = payload()
    const key = resumeParseKey(entry.resumeId)
    const connection = connectRedis(getEnv().REDIS_URL)
    const queue = resumeParseQueue.open({ connection, prefix })
    try {
      expect((await enqueueResumeParse(getEnv().REDIS_URL, entry, key, prefix)).ok).toBe(true)
      expect((await enqueueResumeParse(getEnv().REDIS_URL, entry, key, prefix)).ok).toBe(true)
      expect(await queue.queue.getJobCounts('wait')).toMatchObject({ wait: 1 })
      expect((await queue.queue.getJob(key))?.data).toEqual(entry)
    } finally {
      await queue.queue.obliterate({ force: true })
      await queue.close()
      await connection.quit()
    }
  })
})
