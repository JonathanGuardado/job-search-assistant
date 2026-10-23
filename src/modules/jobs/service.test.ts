import { randomUUID } from 'node:crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import { describe, expect } from 'vitest'
import type { Db } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { dbErrorFrom, dbTest as test } from '@/lib/db/testing'
import { ensureUser } from '@/modules/profiles'
import { unwrap } from '@/lib/result'
import { readNormalizedPosting } from '@/modules/job-sources'
import { jobs } from './schema.js'
import { closeUnseenJobs, getJob, getJobs, listJobUserStates, recordSightings, setJobUserState, upsertJobFromRaw } from './service.js'
import { aBoard, aPosting, aStoredJob, dedupeCases, poll, storedJobs, type GreenhousePosting } from './test-fixtures.js'
import type { Job } from './types.js'

const reread = async (db: Db, written: readonly Job[]) =>
  (await db.select().from(jobs).where(inArray(jobs.id, written.map((j) => j.id)))).sort((a, b) => a.externalId.localeCompare(b.externalId))

/** For an open cluster: its canonical, and every member's link. */
async function links(db: Db, written: readonly Job[]) {
  const rows = await reread(db, written)
  return { canonicals: rows.filter((r) => r.canonicalJobId === null), linked: rows.filter((r) => r.canonicalJobId !== null) }
}

describe('normalizing a raw posting into a job', () => {
  test('writes normalized keys alongside the verbatim posting', async ({ db }) => {
    const [job] = await storedJobs(db, await aBoard(db, 'Acme, Inc.'), [aPosting({ title: 'Senior Backend Engineer (Remote - LATAM)' })])
    if (!job) throw new Error('expected a job')
    expect(job).toMatchObject({
      title: 'Senior Backend Engineer (Remote - LATAM)', titleNormalized: 'backend engineer', seniority: 'senior',
      description: 'We hire anywhere in LATAM.', locationPolicy: 'remote', locationText: 'Remote - LATAM',
      locationCountry: null, employmentType: 'unknown', salary: { source: 'unknown' }, canonicalJobId: null, closedAt: null,
      postedAt: new Date('2026-09-01T12:00:00Z'),
    })
    expect(job).toMatchObject({ companyName: 'Acme, Inc.', companyNormalized: 'acme' })
    expect(job.firstSeenAt).toEqual(job.lastSeenAt)
    expect(unwrap(await getJob(db, job.id))).toEqual(job)
  })

  test('a missing job is a not_found result, not a throw', async ({ db }) => {
    expect(await getJob(db, randomUUID())).toMatchObject({ ok: false, error: { code: 'not_found' } })
  })

  test('the database rejects salary numbers on an unknown salary', async ({ db }) => {
    const job = await aStoredJob(db)
    expect(await dbErrorFrom(db, (d) => d.execute(sql`update jobs set salary_min_minor = 0 where id = ${job.id}`)))
      .toContain('jobs_salary_check')
  })

  test('reads a salary range the posting states in its text, with the line it came from', async ({ db }) => {
    const content = '&lt;p&gt;We hire anywhere in LATAM.&lt;/p&gt;&lt;p&gt;The reasonably estimated yearly salary for this role is:&lt;/p&gt;&lt;p&gt;$143,000—$190,000 USD&lt;/p&gt;'
    const job = await aStoredJob(db, { content })
    expect(job).toMatchObject({ salary: { source: 'posted', minMinor: 14_300_000, maxMinor: 19_000_000, currency: 'USD' }, salaryQuote: '$143,000—$190,000 USD' })
    expect(unwrap(await getJob(db, job.id))).toEqual(job)
    expect((await aStoredJob(db)).salaryQuote).toBeNull()
  })

  test('the database refuses a salary quote on an unknown salary', async ({ db }) => {
    const job = await aStoredJob(db)
    expect(await dbErrorFrom(db, (d) => d.execute(sql`update jobs set salary_quote = 'x' where id = ${job.id}`)))
      .toContain('jobs_salary_quote_check')
  })

  test('replaying a version rewrites the same row', async ({ db }) => {
    const board = await aBoard(db)
    const [posting] = (await poll(db, board, [aPosting()])).postings
    if (!posting) throw new Error('expected a posting')
    const first = unwrap(await upsertJobFromRaw(db, posting.rawJobId))
    expect(unwrap(await upsertJobFromRaw(db, posting.rawJobId))).toEqual(first)
    expect(await db.select().from(jobs).where(eq(jobs.sourceId, board.id))).toHaveLength(1)
  })

  test('an older version normalized after a newer one changes nothing', async ({ db }) => {
    const board = await aBoard(db)
    const original = aPosting({ title: 'Backend Engineer' })
    const [older] = (await poll(db, board, [original], new Date(Date.now() - 60_000))).postings
    const [newer] = (await poll(db, board, [{ ...original, title: 'Platform Engineer' }])).postings
    if (!older || !newer) throw new Error('expected both versions')
    unwrap(await upsertJobFromRaw(db, newer.rawJobId))
    const afterRetry = unwrap(await upsertJobFromRaw(db, older.rawJobId))
    expect(afterRetry).toMatchObject({ title: 'Platform Engineer' })
    // The job dates from the first version, even though the newer one was normalized first.
    expect(afterRetry.firstSeenAt).toEqual(unwrap(await readNormalizedPosting(db, older.rawJobId)).fetchedAt)
  })

  test('a missing raw version is not_found and an unnormalizable one is invalid_input', async ({ db }) => {
    expect(await upsertJobFromRaw(db, randomUUID())).toMatchObject({ ok: false, error: { code: 'not_found' } })
    const [broken] = (await poll(db, await aBoard(db), [aPosting({ title: '' })])).postings
    expect(await upsertJobFromRaw(db, broken?.rawJobId ?? '')).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  })
})

describe('duplicates, on real postings (decision 0008)', () => {
  const stored = async (db: Db, company: string, postings: readonly GreenhousePosting[]) =>
    storedJobs(db, await aBoard(db, company), postings)

  test('the same posting listed twice is linked to one canonical', async ({ db }) => {
    for (const { company, postings } of [dedupeCases.exactRepost, dedupeCases.requisitionNumberOnly]) {
      const { canonicals, linked } = await links(db, await stored(db, company, postings))
      expect(canonicals).toHaveLength(1)
      expect(linked.map((r) => r.canonicalJobId)).toEqual([canonicals[0]?.id])
    }
  })

  test.for([
    ['working hours differ (Pacific vs Eastern)', 'differentWorkingHours'],
    ['one is Senior and one Principal', 'seniorAndPrincipal'],
    ['the same role is posted in three locations', 'sameRoleThreeLocations'],
    ['two different roles share a title and location', 'sameTitleDifferentJobs'],
  ] as const)('nothing is linked when %s', async ([, name], { db }) => {
    const { company, postings } = dedupeCases[name]
    const { linked } = await links(db, await stored(db, company, postings))
    expect(linked).toEqual([])
  })

  test('the same posting on two boards of one company is linked across sources', async ({ db }) => {
    const [first, second] = dedupeCases.exactRepost.postings
    if (!first || !second) throw new Error('expected the repost pair')
    const onGreenhouse = await stored(db, 'Stripe', [first])
    const onSecondBoard = await stored(db, 'Stripe, Inc.', [{ ...first, id: second.id }])
    const { canonicals, linked } = await links(db, [...onGreenhouse, ...onSecondBoard])
    expect(canonicals.map((r) => r.id)).toEqual([onGreenhouse[0]?.id])
    expect(linked.map((r) => r.sourceId)).toEqual([onSecondBoard[0]?.sourceId])
  })

  test('identical text at two different companies is not linked', async ({ db }) => {
    const [posting] = dedupeCases.exactRepost.postings
    if (!posting) throw new Error('expected a posting')
    const written = [...await stored(db, 'Stripe', [posting]), ...await stored(db, 'Brex', [{ ...posting, id: posting.id + 1 }])]
    expect((await links(db, written)).linked).toEqual([])
  })

  test('the earliest-seen posting stays canonical whichever order they are normalized in', async ({ db }) => {
    const board = await aBoard(db, 'Stripe')
    const [early, late] = dedupeCases.exactRepost.postings
    if (!early || !late) throw new Error('expected the repost pair')
    const [first] = (await poll(db, board, [early], new Date(Date.now() - 60_000))).postings
    const page = await poll(db, board, [early, late])
    const second = page.postings.find((p) => p.externalId === String(late.id))
    if (!first || !second) throw new Error('expected both postings')
    const lateJob = unwrap(await upsertJobFromRaw(db, second.rawJobId))
    const earlyJob = unwrap(await upsertJobFromRaw(db, first.rawJobId))
    expect(unwrap(await getJob(db, earlyJob.id)).canonicalJobId).toBeNull()
    expect(unwrap(await getJob(db, lateJob.id)).canonicalJobId).toBe(earlyJob.id)
  })
})

describe('sightings and closing', () => {
  test('asks for normalization of new and changed postings only', async ({ db }) => {
    const board = await aBoard(db)
    const [kept, changed] = [aPosting(), aPosting()]
    await storedJobs(db, board, [kept, changed])
    const page = await poll(db, board, [kept, { ...changed, title: 'Changed' }, aPosting()])
    const { rawJobIdsToNormalize } = await recordSightings(db, { sourceId: board.id, postings: page.postings, seenAt: page.fetchedAt })
    expect([...rawJobIdsToNormalize].sort()).toEqual(page.postings.slice(1).map((p) => p.rawJobId).sort())
  })

  test('closes what the latest poll no longer lists, and reopens it if it returns', async ({ db }) => {
    const board = await aBoard(db)
    const [stays, leaves] = [aPosting(), aPosting()]
    const written = await storedJobs(db, board, [stays, leaves])
    const startedAt = new Date()
    const page = await poll(db, board, [stays], startedAt)
    await recordSightings(db, { sourceId: board.id, postings: page.postings, seenAt: page.fetchedAt })
    expect(await closeUnseenJobs(db, { sourceId: board.id, pollStartedAt: startedAt })).toEqual({ closed: 1, skipped: false })
    const [stayed, left] = await reread(db, written)
    expect(stayed?.closedAt).toBeNull()
    expect(left?.closedAt).toBeInstanceOf(Date)

    const back = await poll(db, board, [stays, leaves])
    await recordSightings(db, { sourceId: board.id, postings: back.postings, seenAt: back.fetchedAt })
    expect((await reread(db, written)).map((r) => r.closedAt)).toEqual([null, null])
  })

  test('a poll that lists none of the board closes nothing', async ({ db }) => {
    const board = await aBoard(db)
    const written = await storedJobs(db, board, [aPosting(), aPosting()])
    const startedAt = new Date()
    await poll(db, board, [], startedAt)
    expect(await closeUnseenJobs(db, { sourceId: board.id, pollStartedAt: startedAt })).toEqual({ closed: 0, skipped: true })
    expect((await reread(db, written)).map((r) => r.closedAt)).toEqual([null, null])
  })

  test('closing a canonical promotes its duplicate, and its return makes it canonical again', async ({ db }) => {
    const board = await aBoard(db, 'Stripe')
    const [early, late] = dedupeCases.exactRepost.postings
    if (!early || !late) throw new Error('expected the repost pair')
    const [first] = (await poll(db, board, [early], new Date(Date.now() - 60_000))).postings
    const [earlyJob] = [unwrap(await upsertJobFromRaw(db, first?.rawJobId ?? ''))]
    const both = await poll(db, board, [early, late])
    const lateJob = unwrap(await upsertJobFromRaw(db, both.postings[1]?.rawJobId ?? ''))
    expect(unwrap(await getJob(db, lateJob.id)).canonicalJobId).toBe(earlyJob.id)

    const startedAt = new Date()
    const onlyLate = await poll(db, board, [late], startedAt)
    await recordSightings(db, { sourceId: board.id, postings: onlyLate.postings, seenAt: onlyLate.fetchedAt })
    await closeUnseenJobs(db, { sourceId: board.id, pollStartedAt: startedAt })
    expect(unwrap(await getJob(db, lateJob.id))).toMatchObject({ canonicalJobId: null, closedAt: null })

    const again = await poll(db, board, [early, late])
    await recordSightings(db, { sourceId: board.id, postings: again.postings, seenAt: again.fetchedAt })
    expect(unwrap(await getJob(db, earlyJob.id)).canonicalJobId).toBeNull()
    expect(unwrap(await getJob(db, lateJob.id)).canonicalJobId).toBe(earlyJob.id)
  })
})

describe('list reads', () => {
  test('getJobs returns the jobs asked for in one call, skipping unknown ids', async ({ db }) => {
    const [a, b] = [await aStoredJob(db), await aStoredJob(db)]
    expect((await getJobs(db, [a.id, b.id, randomUUID()])).map((j) => j.id).sort()).toEqual([a.id, b.id].sort())
    expect(await getJobs(db, [])).toEqual([])
  })

  test('listJobUserStates returns only the candidate\'s own marks', async ({ db }) => {
    const job = await aStoredJob(db)
    const [owner, other] = [await ensureUser(db, { email: `${randomUUID()}@test.local` }), await ensureUser(db, { email: `${randomUUID()}@test.local` })]
    await withTenant(db, owner.id, async (scope) => unwrap(await setJobUserState(scope, { jobId: job.id, state: 'ignored' })))
    expect(await withTenant(db, owner.id, listJobUserStates)).toEqual([expect.objectContaining({ jobId: job.id, state: 'ignored' })])
    expect(await withTenant(db, other.id, listJobUserStates)).toEqual([])
  })
})
