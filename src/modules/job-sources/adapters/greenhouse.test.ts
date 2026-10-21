import { describe, expect, it, vi } from 'vitest'
import { unwrap } from '@/lib/result'
import boardJson from '../__fixtures__/greenhouse-board.json'
import { fixtureSource, greenhouseFixture, rawFixture } from '../test-fixtures.js'
import { greenhouseAdapter } from './greenhouse.js'

const expected = [
  ['8638232002', 'AI Transformation Owner, CRO', 'Remote, United States', 'remote', '2026-07-22T17:38:40.000Z', 'https://job-boards.greenhouse.io/gitlab/jobs/8638232002'],
  ['8002334', 'Alliances & Channels Leader', 'Home Based - Americas; Home based - EMEA; Home based - Worldwide', 'remote', '2026-06-29T10:28:10.000Z', 'https://job-boards.greenhouse.io/canonical/jobs/8002334'],
  ['8705839002', '7CARD: Social Media Specialist', 'Romania (Bucharest - Hybrid)', 'hybrid', '2026-08-13T14:33:23.000Z', 'https://job-boards.greenhouse.io/gympass/jobs/8705839002'],
  ['8122192', 'Account Executive - LATAM', 'Mexico City, Mexico', 'unknown', '2026-08-21T18:22:44.000Z', 'https://stripe.com/jobs/search?gh_jid=8122192'],
  ['8139662', 'Developer Advocate - Service Management', 'California, USA, Remote; New York, USA, Remote', 'remote', '2026-08-18T18:03:28.000Z', 'https://careers.datadoghq.com/detail/8139662/?gh_jid=8139662'],
]

describe('Greenhouse normalization', () => {
  it.each(greenhouseFixture.jobs.map((posting, index) => ({ posting, expected: expected[index] })))('normalizes fixture $posting.id conservatively', ({ posting, expected: row }) => {
    const raw = rawFixture(posting, String(posting.id))
    const job = unwrap(greenhouseAdapter.normalize(raw, fixtureSource))
    expect([job.externalId, job.title, job.locationText, job.locationPolicy, job.postedAt?.toISOString(), job.applyUrl]).toEqual(row)
    expect(job).toMatchObject({ companyName: 'Fixture Co', locationCountry: null, employmentType: 'unknown', salary: { source: 'unknown' } })
    expect(job.description).not.toMatch(/<|&lt;/)
    expect(greenhouseAdapter.normalize(raw, fixtureSource)).toEqual({ ok: true, value: job })
  })
  it.each([
    ['US - Remote or Hybrid', 'unknown'], ['Non-remote, Berlin', 'unknown'], ['Not remote', 'unknown'],
    ['Berlin', 'unknown'], ['Hybrid', 'hybrid'], ['Home-based', 'remote'], [null, 'unknown'],
  ])('classifies %s as %s', (location, policy) => {
    const payload = { ...greenhouseFixture.jobs[0], location: location === null ? null : { name: location } }
    expect(unwrap(greenhouseAdapter.normalize(rawFixture(payload), fixtureSource)).locationPolicy).toBe(policy)
  })
  it('reports an invalid payload with its external id and field path', () => {
    const result = greenhouseAdapter.normalize(rawFixture({ id: 1 }), fixtureSource)
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input', message: expect.stringContaining('malformed-posting') } })
    expect(!result.ok && result.error.message).toContain('title')
  })
  it('keeps titles decorated and unknown dates unset', () => {
    const payload = { ...greenhouseFixture.jobs[0], title: ' Engineer (Remote) ', first_published: 'not-a-date', location: { name: '  ' } }
    expect(unwrap(greenhouseAdapter.normalize(rawFixture(payload), fixtureSource))).toMatchObject({ title: 'Engineer (Remote)', postedAt: null, locationText: null })
  })
})

describe('Greenhouse requests', () => {
  it('fetches the exact jobs endpoint and preserves each raw payload', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(greenhouseFixture))
    const fetched = unwrap(await greenhouseAdapter.fetchPage(fixtureSource, null, fetcher))
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://boards-api.greenhouse.io/v1/boards/fixture/jobs?content=true&pay_transparency=true')
    expect(fetched.next).toBeNull()
    expect(fetched.raw.map((raw) => raw.externalId)).toEqual(greenhouseFixture.jobs.map((job) => String(job.id)))
    expect(fetched.raw.map((raw) => raw.payload)).toEqual(greenhouseFixture.jobs)
  })
  it('rejects a non-null cursor before fetching', async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await greenhouseAdapter.fetchPage(fixtureSource, '100', fetcher)).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([[404, 'not_found'], [500, 'upstream_failed']])('maps HTTP %s to %s', async (status, code) => {
    expect(await greenhouseAdapter.fetchPage(fixtureSource, null, async () => new Response('private body', { status }))).toMatchObject({ ok: false, error: { code } })
  })
  it('returns failures for thrown fetches and wrong envelopes', async () => {
    expect(await greenhouseAdapter.fetchPage(fixtureSource, null, async () => { throw new Error('secret') })).toMatchObject({ ok: false, error: { code: 'upstream_failed' } })
    expect(await greenhouseAdapter.fetchPage(fixtureSource, null, async () => Response.json({ jobs: [{}] }))).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
  })
  it('checks board health, including not-found and unreachable boards', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(boardJson))
    expect(await greenhouseAdapter.health(fixtureSource, fetcher)).toMatchObject({ ok: true })
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://boards-api.greenhouse.io/v1/boards/fixture')
    expect(await greenhouseAdapter.health(fixtureSource, async () => new Response(null, { status: 404 }))).toMatchObject({ ok: false, message: 'Board not found' })
    expect(await greenhouseAdapter.health(fixtureSource, async () => { throw new Error('secret') })).toMatchObject({ ok: false })
  })
})
