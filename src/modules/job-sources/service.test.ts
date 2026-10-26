import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { describe, expect, vi } from 'vitest'
import type { Db } from '@/lib/db/client'
import { dbErrorFrom, dbTest as test } from '@/lib/db/testing'
import { domainError, err, ok, unwrap } from '@/lib/result'
import type { AdapterKey, Fetcher } from './adapter.js'
import { POLL_INTERVAL_MS } from './queues.js'
import { jobSources, rawJobs } from './schema.js'
import {
  addSource, checkNormalization, dispatchSourcePolls, getApplicationForms, listLatestRawJobIds, listSources, pollSourcePage, postingKey,
  readNormalizedPosting, refreshApplicationForm, setSourceEnabled, sourcePublishesForms,
} from './service.js'
import { greenhouseFixture, leverFixture } from './test-fixtures.js'

async function source(db: Db, adapterKey: AdapterKey = 'greenhouse') {
  return unwrap(await addSource(db, { adapterKey, name: `Fixture Co ${randomUUID()}`, token: randomUUID() }, async () => Response.json(adapterKey === 'greenhouse' ? { name: 'Fixture' } : [])))
}
const rows = (db: Db, sourceId: string) => db.select().from(rawJobs).where(eq(rawJobs.sourceId, sourceId))
const fixtureFetcher: Fetcher = async () => Response.json(greenhouseFixture)
const nextPage = async () => ok(undefined)
const startedAt = new Date('2026-10-21T00:00:00Z')
const payload = (sourceId: string) => ({ sourceId, pollId: 'test-poll', cursor: null, startedAt })

describe('source registration and controls', () => {
  test('registers only healthy sources and rejects duplicate tokens without aborting the transaction', async ({ db }) => {
    const healthy = await source(db)
    expect(healthy).toMatchObject({ healthStatus: 'ok', enabled: true, cursor: null, lastPolledAt: null })
    expect(healthy.healthCheckedAt).toBeInstanceOf(Date)
    if (healthy.config === null) throw new Error('a registered source has a valid config')
    const duplicate = await addSource(db, { name: 'Duplicate', adapterKey: healthy.adapterKey, token: healthy.config.token }, async () => Response.json({ name: 'Fixture' }))
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'conflict' } })
    const token = randomUUID()
    expect(await addSource(db, { name: 'Missing', adapterKey: 'greenhouse', token }, async () => new Response(null, { status: 404 }))).toMatchObject({ ok: false, error: { code: 'invalid_input', message: 'Board not found' } })
    expect(await db.select().from(jobSources).where(sql`${jobSources.config}->>'token' = ${token}`)).toEqual([])
    expect((await listSources(db)).find((entry) => entry.id === healthy.id)?.rawJobCount).toBe(0)
  })
  test('lists sources by name with their captured counts and toggles enabled state', async ({ db }) => {
    const first = await source(db)
    const second = await source(db)
    await db.update(jobSources).set({ name: 'A fixture' }).where(eq(jobSources.id, first.id))
    await db.update(jobSources).set({ name: 'Z fixture' }).where(eq(jobSources.id, second.id))
    await pollSourcePage(db, payload(first.id), { fetcher: fixtureFetcher, enqueueNextPage: nextPage })
    const listed = (await listSources(db)).filter((entry) => entry.id === first.id || entry.id === second.id)
    expect(listed.map((entry) => [entry.name, entry.rawJobCount])).toEqual([['A fixture', 5], ['Z fixture', 0]])
    expect((await setSourceEnabled(db, first.id, false)).ok).toBe(true)
    expect((await listSources(db)).find((entry) => entry.id === first.id)?.enabled).toBe(false)
    expect((await setSourceEnabled(db, first.id, true)).ok).toBe(true)
    expect(await setSourceEnabled(db, randomUUID(), false)).toMatchObject({ ok: false, error: { code: 'not_found' } })
  })
  test('lists a source whose stored config no longer parses with a null config', async ({ db }) => {
    const [broken] = await db.insert(jobSources).values({ adapterKey: 'lever', name: 'Broken', config: { token: 'bad token!' } }).returning()
    if (!broken) throw new Error('insert returned no row')
    expect((await listSources(db)).find((entry) => entry.id === broken.id)?.config).toBeNull()
  })
})

describe('page polling and immutable capture', () => {
  test('inserts five raw postings atomically, deduplicates repolls, and keeps changed versions separately', async ({ db }) => {
    const board = await source(db)
    expect((await pollSourcePage(db, payload(board.id), { fetcher: fixtureFetcher, enqueueNextPage: nextPage })).ok).toBe(true)
    const initial = await rows(db, board.id)
    expect(initial).toHaveLength(5)
    // The select has no order; compare as sets of payloads.
    expect(initial.map((row) => row.payload)).toEqual(expect.arrayContaining(greenhouseFixture.jobs))
    const [polled] = await db.select().from(jobSources).where(eq(jobSources.id, board.id))
    expect(polled).toMatchObject({ healthStatus: 'ok', healthMessage: null, cursor: null })
    expect(polled?.lastPolledAt).toBeInstanceOf(Date)
    expect(polled?.healthCheckedAt).toBeInstanceOf(Date)
    await pollSourcePage(db, payload(board.id), { fetcher: fixtureFetcher, enqueueNextPage: nextPage })
    expect(await rows(db, board.id)).toHaveLength(5)
    const updated = { jobs: greenhouseFixture.jobs.map((job, index) => index === 0 ? { ...job, title: 'Changed title' } : job) }
    await pollSourcePage(db, payload(board.id), { fetcher: async () => Response.json(updated), enqueueNextPage: nextPage })
    expect(await rows(db, board.id)).toHaveLength(6)
    for (const original of initial) {
      const [stored] = await db.select().from(rawJobs).where(eq(rawJobs.id, original.id))
      expect(stored).toEqual(original)
    }
  })
  test('persists the next Lever cursor and enqueues it with the same poll id', async ({ db }) => {
    const site = await source(db, 'lever')
    const full = Array.from({ length: 100 }, (_, index) => ({ ...leverFixture[0], id: `posting-${index}` }))
    const enqueueNextPage = vi.fn().mockResolvedValue(ok(undefined))
    expect((await pollSourcePage(db, payload(site.id), { fetcher: async () => Response.json(full), enqueueNextPage })).ok).toBe(true)
    expect(await rows(db, site.id)).toHaveLength(100)
    expect(enqueueNextPage).toHaveBeenCalledWith({ sourceId: site.id, pollId: 'test-poll', cursor: '100', startedAt })
    const [polling] = await db.select().from(jobSources).where(eq(jobSources.id, site.id))
    expect(polling).toMatchObject({ cursor: '100', lastPolledAt: null, healthStatus: 'ok' })
    await pollSourcePage(db, { ...payload(site.id), cursor: '100' }, { fetcher: async () => Response.json([]), enqueueNextPage })
    const [completed] = await db.select().from(jobSources).where(eq(jobSources.id, site.id))
    expect(completed?.cursor).toBeNull()
    expect(completed?.lastPolledAt).toBeInstanceOf(Date)
    expect(enqueueNextPage).toHaveBeenCalledTimes(1)
  })
  test('a failed next-page enqueue retains the committed page so a retry cannot duplicate capture', async ({ db }) => {
    const site = await source(db, 'lever')
    const full = Array.from({ length: 100 }, (_, index) => ({ ...leverFixture[0], id: `posting-${index}` }))
    const failure = err(domainError('upstream_failed', 'queue unavailable'))
    const fetcher: Fetcher = async () => Response.json(full)
    expect(await pollSourcePage(db, payload(site.id), { fetcher, enqueueNextPage: async () => failure })).toEqual(failure)
    expect(await rows(db, site.id)).toHaveLength(100)
    expect((await pollSourcePage(db, payload(site.id), { fetcher, enqueueNextPage: nextPage })).ok).toBe(true)
    expect(await rows(db, site.id)).toHaveLength(100)
  })
  test('records fetch failures without discarding the page cursor', async ({ db }) => {
    const board = await source(db)
    await db.update(jobSources).set({ cursor: '100' }).where(eq(jobSources.id, board.id))
    const result = await pollSourcePage(db, payload(board.id), { fetcher: async () => new Response(null, { status: 500 }), enqueueNextPage: nextPage })
    expect(result).toMatchObject({ ok: false, error: { code: 'upstream_failed', message: 'HTTP 500' } })
    const [failed] = await db.select().from(jobSources).where(eq(jobSources.id, board.id))
    expect(failed).toMatchObject({ healthStatus: 'failing', healthMessage: 'HTTP 500', cursor: '100', lastPolledAt: null })
    expect(failed?.healthCheckedAt).toBeInstanceOf(Date)
    expect(await rows(db, board.id)).toHaveLength(0)
  })
  test('disabled and missing sources never fetch; invalid stored config is recorded', async ({ db }) => {
    const board = await source(db)
    const fetcher = vi.fn<typeof fetch>()
    await setSourceEnabled(db, board.id, false)
    expect(await pollSourcePage(db, payload(board.id), { fetcher, enqueueNextPage: nextPage })).toEqual({ ok: true, value: { kind: 'disabled' } })
    expect(await pollSourcePage(db, payload(randomUUID()), { fetcher, enqueueNextPage: nextPage })).toMatchObject({ ok: false, error: { code: 'not_found' } })
    await setSourceEnabled(db, board.id, true)
    await db.update(jobSources).set({ config: sql`'{}'::jsonb` }).where(eq(jobSources.id, board.id))
    expect(await pollSourcePage(db, payload(board.id), { fetcher, enqueueNextPage: nextPage })).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    expect(fetcher).not.toHaveBeenCalled()
    expect((await db.select().from(jobSources).where(eq(jobSources.id, board.id)))[0]?.healthStatus).toBe('failing')
  })
  test('a Greenhouse repoll that only bumps updated_at stores nothing new', async ({ db }) => {
    const board = await source(db)
    await pollSourcePage(db, payload(board.id), { fetcher: fixtureFetcher, enqueueNextPage: nextPage })
    const bumped = { jobs: greenhouseFixture.jobs.map((job) => ({ ...job, updated_at: '2026-10-22T09:00:00-04:00' })) }
    await pollSourcePage(db, payload(board.id), { fetcher: async () => Response.json(bumped), enqueueNextPage: nextPage })
    expect(await rows(db, board.id)).toHaveLength(5)
  })
  test('reports every posting on the page with its current raw version, unchanged ones included', async ({ db }) => {
    const board = await source(db)
    const first = unwrap(await pollSourcePage(db, payload(board.id), { fetcher: fixtureFetcher, enqueueNextPage: nextPage }))
    if (first.kind !== 'page') throw new Error('expected a page')
    expect(first.isFinalPage).toBe(true)
    expect(first.postings.map((p) => p.externalId)).toEqual(greenhouseFixture.jobs.map((job) => String(job.id)))
    const changed = { jobs: greenhouseFixture.jobs.map((job, index) => index === 0 ? { ...job, title: 'Changed title' } : job) }
    const second = unwrap(await pollSourcePage(db, payload(board.id), { fetcher: async () => Response.json(changed), enqueueNextPage: nextPage }))
    if (second.kind !== 'page') throw new Error('expected a page')
    const [newVersion] = await db.select().from(rawJobs).where(and(eq(rawJobs.sourceId, board.id), sql`${rawJobs.payload}->>'title' = 'Changed title'`))
    expect(second.postings[0]).toEqual({ externalId: String(greenhouseFixture.jobs[0]?.id), rawJobId: newVersion?.id })
    expect(second.postings.slice(1)).toEqual(first.postings.slice(1))
    expect([...await listLatestRawJobIds(db)].filter((id) => second.postings.some((p) => p.rawJobId === id)).sort())
      .toEqual(second.postings.map((p) => p.rawJobId).sort())
  })
  test('the app role cannot UPDATE or DELETE raw jobs', async ({ db }) => {
    const board = await source(db)
    await pollSourcePage(db, payload(board.id), { fetcher: fixtureFetcher, enqueueNextPage: nextPage })
    expect(await dbErrorFrom(db, (executor) => executor.update(rawJobs).set({ externalId: 'mutated' }).where(eq(rawJobs.sourceId, board.id)))).toContain('permission denied')
    expect(await dbErrorFrom(db, (executor) => executor.delete(rawJobs).where(eq(rawJobs.sourceId, board.id)))).toContain('permission denied')
    expect(await rows(db, board.id)).toHaveLength(5)
  })
})

describe('scheduled dispatch', () => {
  test('selects only enabled sources due for the six-hour window', async ({ db }) => {
    const never = await source(db)
    const recent = await source(db)
    const old = await source(db)
    const disabled = await source(db)
    const now = new Date('2026-10-20T13:15:00Z')
    await db.update(jobSources).set({ lastPolledAt: new Date(now.getTime() - 60 * 60_000) }).where(eq(jobSources.id, recent.id))
    await db.update(jobSources).set({ lastPolledAt: new Date(now.getTime() - 7 * 60 * 60_000) }).where(eq(jobSources.id, old.id))
    await setSourceEnabled(db, disabled.id, false)
    const enqueue = vi.fn().mockResolvedValue(ok(undefined))
    const result = unwrap(await dispatchSourcePolls(db, now, enqueue))
    const requested = enqueue.mock.calls.map(([entry]) => entry)
    expect(result.enqueued).toBe(2)
    expect(requested.map((entry) => entry.sourceId).sort()).toEqual([never.id, old.id].sort())
    for (const entry of requested) expect(entry).toMatchObject({ cursor: null, startedAt: now, pollId: `w${Math.floor(now.getTime() / POLL_INTERVAL_MS) * POLL_INTERVAL_MS}` })
    const repeated = vi.fn().mockResolvedValue(ok(undefined))
    await dispatchSourcePolls(db, now, repeated)
    expect(repeated.mock.calls).toEqual(enqueue.mock.calls)
  })
  test('returns an enqueue failure rather than pretending dispatch succeeded', async ({ db }) => {
    await source(db)
    const failure = err(domainError('upstream_failed', 'queue unavailable'))
    expect(await dispatchSourcePolls(db, new Date(), async () => failure)).toEqual(failure)
  })
})

describe('normalization audit', () => {
  test('checks both fixture sets and reports malformed captured payloads without writing jobs', async ({ db }) => {
    const board = await source(db)
    const site = await source(db, 'lever')
    await pollSourcePage(db, payload(board.id), { fetcher: fixtureFetcher, enqueueNextPage: nextPage })
    await pollSourcePage(db, payload(site.id), { fetcher: async () => Response.json(leverFixture), enqueueNextPage: nextPage })
    expect(await checkNormalization(db)).toEqual({ checked: 10, failures: [] })
    await db.insert(rawJobs).values({ sourceId: board.id, externalId: 'broken', payload: { id: 1 }, contentHash: '0'.repeat(64), fetchedAt: new Date() })
    const report = await checkNormalization(db)
    expect(report.checked).toBe(11)
    expect(report.failures).toEqual([{ sourceId: board.id, externalId: 'broken', message: expect.stringContaining('title') }])
    expect(await db.select().from(rawJobs).where(and(eq(rawJobs.sourceId, board.id), eq(rawJobs.externalId, 'broken')))).toHaveLength(1)
  })
})

describe('reading a stored posting for normalization', () => {
  test('normalizes the stored version with its source and the time the posting was first seen', async ({ db }) => {
    const board = await source(db)
    const first = unwrap(await pollSourcePage(db, payload(board.id), { fetcher: fixtureFetcher, enqueueNextPage: nextPage }))
    const changed = { jobs: greenhouseFixture.jobs.map((job, index) => index === 0 ? { ...job, title: 'Changed title' } : job) }
    const second = unwrap(await pollSourcePage(db, payload(board.id), { fetcher: async () => Response.json(changed), enqueueNextPage: nextPage }))
    if (first.kind !== 'page' || second.kind !== 'page') throw new Error('expected pages')
    const [original] = await db.select().from(rawJobs).where(eq(rawJobs.id, first.postings[0]?.rawJobId ?? ''))
    const posting = unwrap(await readNormalizedPosting(db, second.postings[0]?.rawJobId ?? ''))
    expect(posting).toMatchObject({
      rawJobId: second.postings[0]?.rawJobId, sourceId: board.id, externalId: String(greenhouseFixture.jobs[0]?.id),
      firstFetchedAt: original?.fetchedAt, job: { title: 'Changed title', companyName: board.name },
    })
  })
  test('a missing raw job is not_found and an unusable stored config is invalid_input', async ({ db }) => {
    expect(await readNormalizedPosting(db, randomUUID())).toMatchObject({ ok: false, error: { code: 'not_found' } })
    const board = await source(db)
    const page = unwrap(await pollSourcePage(db, payload(board.id), { fetcher: fixtureFetcher, enqueueNextPage: nextPage }))
    if (page.kind !== 'page') throw new Error('expected a page')
    await db.update(jobSources).set({ config: sql`'{}'::jsonb` }).where(eq(jobSources.id, board.id))
    expect(await readNormalizedPosting(db, page.postings[0]?.rawJobId ?? '')).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  })
})

describe('application forms (decision 0013)', () => {
  const form: unknown = JSON.parse(readFileSync(new URL('./__fixtures__/greenhouse-application-gitlab.json', import.meta.url), 'utf8'))

  test('fetches, stores and replaces a posting\'s form, readable in one call for many postings', async ({ db }) => {
    const board = await source(db)
    const posting = { sourceId: board.id, externalId: '8860302002' }
    const stored = unwrap(await refreshApplicationForm(db, posting, async () => Response.json(form)))
    expect(stored).toMatchObject({ kind: 'stored', form: { questions: expect.arrayContaining([expect.objectContaining({ label: 'Resume/CV' })]) } })
    const first = (await getApplicationForms(db, [posting, { sourceId: board.id, externalId: '1' }])).get(postingKey(posting))
    expect(first?.form.questions).toHaveLength(16)

    const changed: unknown = JSON.parse(JSON.stringify(form).replace('"Resume/CV"', '"Resume"'))
    unwrap(await refreshApplicationForm(db, posting, async () => Response.json(changed)))
    const forms = await getApplicationForms(db, [posting])
    expect(forms.size).toBe(1)
    expect(forms.get(postingKey(posting))?.form.questions.some((q) => q.label === 'Resume')).toBe(true)
    expect(await getApplicationForms(db, [])).toEqual(new Map())
  })

  test('a source without structured forms is unsupported; a closed posting is not_found', async ({ db }) => {
    const lever = await source(db, 'lever')
    expect(unwrap(await refreshApplicationForm(db, { sourceId: lever.id, externalId: 'abc' }, fixtureFetcher))).toEqual({ kind: 'unsupported' })
    expect(await sourcePublishesForms(db, lever.id)).toBe(false)
    const board = await source(db)
    expect(await sourcePublishesForms(db, board.id)).toBe(true)
    expect(await refreshApplicationForm(db, { sourceId: board.id, externalId: '42' }, async () => new Response('', { status: 404 })))
      .toMatchObject({ ok: false, error: { code: 'not_found' } })
  })
})
