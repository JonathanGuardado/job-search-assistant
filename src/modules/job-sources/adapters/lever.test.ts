import { describe, expect, it, vi } from 'vitest'
import { unwrap } from '@/lib/result'
import { fixtureSource, leverFixture, rawFixture } from '../test-fixtures.js'
import { LEVER_PAGE_SIZE, leverAdapter } from './lever.js'

const expected = [
  { externalId: 'ad208490-4052-4f91-a57e-433f2d1e484b', locationText: 'Atlanta, Georgia', locationPolicy: 'hybrid', locationCountry: 'US', employmentType: 'unknown', salary: { source: 'posted', minMinor: 8500000, maxMinor: 17500000, currency: 'USD' }, postedAt: new Date('2026-08-31T18:12:19.703Z') },
  { externalId: '93db84be-2f79-4264-b521-510409fd0225', locationText: 'Baltimore, MD', locationPolicy: 'unknown', locationCountry: 'US', employmentType: 'unknown', salary: { source: 'unknown' }, postedAt: new Date('2022-03-10T01:00:47.490Z') },
  { externalId: '5992c673-e493-48b1-bb63-9b82a4c31876', locationText: 'London', locationPolicy: 'onsite', locationCountry: 'GB', employmentType: 'contractor', salary: { source: 'unknown' }, postedAt: new Date('2026-07-29T15:08:17.614Z') },
  { externalId: '8c5cd7a4-7d7d-40eb-acd3-4b8d21ad5199', locationText: 'Canada', locationPolicy: 'remote', locationCountry: 'CA', employmentType: 'unknown', salary: { source: 'unknown' }, postedAt: new Date('2026-08-11T13:09:43.426Z') },
  { externalId: '24778718-9d98-490d-a37b-64dcc8e96edf', locationText: 'Montevideo (Hybrid)', locationPolicy: 'hybrid', locationCountry: 'UY', employmentType: 'unknown', salary: { source: 'unknown' }, postedAt: new Date('2026-05-20T18:13:13.815Z') },
]

describe('Lever normalization', () => {
  it.each(leverFixture.map((posting, index) => ({ posting, expected: expected[index] })))('normalizes fixture $posting.id deterministically', ({ posting, expected: row }) => {
    const raw = rawFixture(posting, posting.id)
    const job = unwrap(leverAdapter.normalize(raw, fixtureSource))
    expect(job).toMatchObject({ ...row, companyName: 'Fixture Co', title: posting.text.trim(), applyUrl: posting.applyUrl })
    expect(job.description).not.toMatch(/<|&lt;/)
    expect(leverAdapter.normalize(raw, fixtureSource)).toEqual({ ok: true, value: job })
  })
  it.each([
    { interval: 'per-hour-wage', min: 10, currency: 'USD' },
    { interval: 'per-year-salary', min: 200, max: 100, currency: 'USD' },
    { interval: 'per-year-salary', min: 100, currency: 'usd' },
    { interval: 'per-year-salary', currency: 'USD' },
    { interval: 'per-year-salary', min: -1, currency: 'USD' },
    { interval: 'per-year-salary', min: Number.MAX_SAFE_INTEGER, currency: 'USD' },
  ])('keeps ambiguous or invalid salaries unknown: %j', (salaryRange) => {
    expect(unwrap(leverAdapter.normalize(rawFixture({ ...leverFixture[0], salaryRange }), fixtureSource)).salary).toEqual({ source: 'unknown' })
  })
  it.each([
    [{ interval: 'per-year-salary', max: 100, currency: 'USD' }, { source: 'posted', minMinor: null, maxMinor: 10000, currency: 'USD' }],
    [{ interval: 'per-year-salary', min: 5000000, currency: 'JPY' }, { source: 'posted', minMinor: 5000000, maxMinor: null, currency: 'JPY' }],
    [{ interval: 'per-year-salary', min: 1.234, currency: 'KWD' }, { source: 'posted', minMinor: 1234, maxMinor: null, currency: 'KWD' }],
    [{ interval: 'per-year-salary', min: 0, currency: 'USD' }, { source: 'posted', minMinor: 0, maxMinor: null, currency: 'USD' }],
  ])('maps explicit annual salary %j', (salaryRange, salary) => {
    expect(unwrap(leverAdapter.normalize(rawFixture({ ...leverFixture[0], salaryRange }), fixtureSource)).salary).toEqual(salary)
  })
  it.each([['Fixed-Term Contract', 'unknown'], ['Contract', 'contractor'], ['Full-time', 'unknown']])('maps commitment %s to %s', (commitment, employmentType) => {
    expect(unwrap(leverAdapter.normalize(rawFixture({ ...leverFixture[0], categories: { commitment } }), fixtureSource)).employmentType).toBe(employmentType)
  })
  it('rejects an apply URL that is not http or https', () => {
    const result = leverAdapter.normalize(rawFixture({ ...leverFixture[0], applyUrl: 'javascript:alert(1)' }), fixtureSource)
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  })
  it('reports malformed postings with external id and field path', () => {
    const result = leverAdapter.normalize(rawFixture({ id: 'missing-title' }), fixtureSource)
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input', message: expect.stringContaining('malformed-posting') } })
    expect(!result.ok && result.error.message).toContain('text')
  })
  it('uses hostedUrl as fallback, leaves unknown location data unset, and does not guess a date', () => {
    const posting = { id: 'minimal', text: ' Engineer (Remote) ', hostedUrl: 'https://jobs.lever.co/fixture/minimal', country: 'us' }
    expect(unwrap(leverAdapter.normalize(rawFixture(posting), fixtureSource))).toMatchObject({
      title: 'Engineer (Remote)', description: '', applyUrl: posting.hostedUrl, locationPolicy: 'unknown', locationCountry: null, locationText: null, postedAt: null,
    })
  })
  // Payloads come from JSON, so a malformed number arrives as a string or null, never NaN.
  it.each(['1786469891368', null, 1e20])('leaves an unusable timestamp %j null without rejecting the posting', (createdAt) => {
    expect(unwrap(leverAdapter.normalize(rawFixture({ ...leverFixture[0], createdAt }), fixtureSource)).postedAt).toBeNull()
  })
  it.each([{ min: '85000' }, { max: '175000' }, { min: true }])('keeps a salary with a non-numeric bound %j unknown without rejecting the posting', (bounds) => {
    const salaryRange = { min: 85000, max: 175000, currency: 'USD', interval: 'per-year-salary', ...bounds }
    expect(unwrap(leverAdapter.normalize(rawFixture({ ...leverFixture[0], salaryRange }), fixtureSource)).salary).toEqual({ source: 'unknown' })
  })
  it('treats a null salary bound as absent', () => {
    const salaryRange = { min: null, max: 100, currency: 'USD', interval: 'per-year-salary' }
    expect(unwrap(leverAdapter.normalize(rawFixture({ ...leverFixture[0], salaryRange }), fixtureSource)).salary)
      .toEqual({ source: 'posted', minMinor: null, maxMinor: 10000, currency: 'USD' })
  })
})

describe('Lever requests', () => {
  it('fetches the exact first-page URL and keeps postings verbatim', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(leverFixture))
    const page = unwrap(await leverAdapter.fetchPage(fixtureSource, null, fetcher))
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.lever.co/v0/postings/fixture?mode=json&skip=0&limit=100')
    expect(page.next).toBeNull()
    expect(page.raw.map((raw) => raw.externalId)).toEqual(leverFixture.map((job) => job.id))
    expect(page.raw.map((raw) => raw.payload)).toEqual(leverFixture)
  })
  it('continues a full page at skip=100', async () => {
    expect(LEVER_PAGE_SIZE).toBe(100)
    const full = Array.from({ length: 100 }, (_, index) => ({ ...leverFixture[0], id: `job-${index}` }))
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(full))
    expect(unwrap(await leverAdapter.fetchPage(fixtureSource, null, fetcher)).next).toBe('100')
    expect(unwrap(await leverAdapter.fetchPage(fixtureSource, '100', fetcher)).next).toBe('200')
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://api.lever.co/v0/postings/fixture?mode=json&skip=100&limit=100')
  })
  it.each(['-1', 'first', '1.5', '90071992547409999999999'])('rejects an invalid cursor %s before fetching', async (cursor) => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await leverAdapter.fetchPage(fixtureSource, cursor, fetcher)).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([[404, 'not_found'], [500, 'upstream_failed']])('maps HTTP %s to %s', async (status, code) => {
    expect(await leverAdapter.fetchPage(fixtureSource, null, async () => new Response(null, { status }))).toMatchObject({ ok: false, error: { code } })
  })
  it('returns failures for thrown fetches and malformed envelopes', async () => {
    expect(await leverAdapter.fetchPage(fixtureSource, null, async () => { throw new Error('secret') })).toMatchObject({ ok: false, error: { code: 'upstream_failed' } })
    expect(await leverAdapter.fetchPage(fixtureSource, null, async () => Response.json({ postings: [] }))).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
  })
  it('checks site health, accepting an empty array and reporting a missing site', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]))
    expect(await leverAdapter.health(fixtureSource, fetcher)).toMatchObject({ ok: true })
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.lever.co/v0/postings/fixture?mode=json&limit=1')
    expect(await leverAdapter.health(fixtureSource, async () => new Response(null, { status: 404 }))).toMatchObject({ ok: false, message: 'Site not found' })
    expect(await leverAdapter.health(fixtureSource, async () => { throw new Error('secret') })).toMatchObject({ ok: false })
  })
})
