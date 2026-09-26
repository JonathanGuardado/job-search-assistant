import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { describe, expect } from 'vitest'
import { dbErrorFrom, dbTest as test } from '@/lib/db/testing'
import { unwrap } from '@/lib/result'
import { getJob, insertJob, markJobSeen } from './service.js'
import { aNewJob } from './test-fixtures.js'
import { NewJobSchema } from './types.js'

describe('jobs service', () => {
  test('a job written through the module reads back identically', async ({ db }) => {
    const input = aNewJob({
      salary: { source: 'posted', minMinor: 9_000_000, maxMinor: 12_000_000, currency: 'USD' },
    })
    const written = await insertJob(db, input)
    const read = unwrap(await getJob(db, written.id))

    expect(read).toEqual(written)
    expect(read).toMatchObject({
      companyName: input.companyName,
      salary: input.salary,
      firstSeenAt: input.seenAt,
      lastSeenAt: input.seenAt,
      canonicalJobId: null,
      closedAt: null,
    })
  })

  test('an unposted salary stays unknown rather than becoming zero', async ({ db }) => {
    const written = await insertJob(db, aNewJob({ salary: { source: 'unknown' } }))
    expect(unwrap(await getJob(db, written.id)).salary).toEqual({ source: 'unknown' })
  })

  test('a missing job is a not_found result, not a throw', async ({ db }) => {
    const result = await getJob(db, randomUUID())
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('not_found')
  })

  test('markJobSeen is idempotent and never moves last_seen_at backwards', async ({ db }) => {
    const job = await insertJob(db, aNewJob({ seenAt: new Date('2026-09-01T00:00:00Z') }))
    const later = new Date('2026-09-10T00:00:00Z')

    await markJobSeen(db, { jobId: job.id, seenAt: later })
    await markJobSeen(db, { jobId: job.id, seenAt: later })
    await markJobSeen(db, { jobId: job.id, seenAt: new Date('2026-09-05T00:00:00Z') })

    const read = unwrap(await getJob(db, job.id))
    expect(read.lastSeenAt).toEqual(later)
    expect(read.firstSeenAt).toEqual(job.firstSeenAt)
  })

  test('the database rejects salary numbers on an unknown salary', async ({ db }) => {
    const job = await insertJob(db, aNewJob({ salary: { source: 'unknown' } }))
    const error = await dbErrorFrom(db, (d) =>
      d.execute(sql`update jobs set salary_min_minor = 0 where id = ${job.id}`),
    )
    expect(error).toContain('jobs_salary_check')
  })
})

describe('NewJobSchema', () => {
  test('rejects a posted salary whose minimum exceeds its maximum', () => {
    const parsed = NewJobSchema.safeParse(
      aNewJob({ salary: { source: 'posted', minMinor: 10, maxMinor: 5, currency: 'USD' } }),
    )
    expect(parsed.success).toBe(false)
  })

  test('rejects a posted salary with neither bound', () => {
    const parsed = NewJobSchema.safeParse(
      aNewJob({ salary: { source: 'posted', minMinor: null, maxMinor: null, currency: 'USD' } }),
    )
    expect(parsed.success).toBe(false)
  })
})
