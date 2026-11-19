import { afterEach, describe, expect, it, vi } from 'vitest'
import { unwrap } from '@/lib/result'
import { himalayasFixture, rawFixture } from '../test-fixtures.js'
import { himalayasAdapter } from './himalayas.js'

const source = { name: 'Himalayas', config: { token: 'XT' } }
const expected = [
  { externalId: 'ejemplo-digital/senior-backend-engineer', companyName: 'Ejemplo Digital', title: 'Senior Backend Engineer', remoteCountries: 'AI AG AR AW BS BB BZ BM BO BQ BR KY CL CO CR CU DM DO EC SV FK GD GT GY HT HN JM MX MS NI PA PY PE PR KN LC VC GS SR TT TC UY VE VG VI'.split(' '), employmentType: 'unknown', postedAt: new Date('2026-11-11T12:26:40.000Z') },
  { externalId: 'fixture-annotations/data-labeling-contractor', companyName: 'Fixture Annotations', title: 'Data Labeling Contractor', remoteCountries: null, employmentType: 'contractor', postedAt: new Date('2026-11-10T08:40:00.000Z') },
  { externalId: 'nombres-raros/support-engineer', companyName: 'Nombres Raros', title: 'Support Engineer', remoteCountries: ['TR', 'RU', 'CD', 'HK', 'SV', 'CI'], employmentType: 'unknown', postedAt: new Date('2026-11-09T04:53:20.000Z') },
  { externalId: 'solo-pais/field-engineer', companyName: 'Solo País S.A. de C.V.', title: 'Field Engineer', remoteCountries: ['SV'], employmentType: 'unknown', postedAt: null },
  { externalId: 'followed-co/platform-engineer', companyName: 'Followed Co, Inc.', title: 'Platform Engineer', remoteCountries: ['US', 'SV'], employmentType: 'unknown', postedAt: new Date('2026-11-08T01:06:40.000Z') },
  { externalId: 'lugar-desconocido/design-intern', companyName: 'Lugar Desconocido', title: 'Design Intern', remoteCountries: null, employmentType: 'unknown', postedAt: new Date('2026-11-06T21:20:00.000Z') },
]
const descriptions = [
  'Ejemplo Digital builds billing tools for clinics & labs.\n\n\nWHAT YOU WILL DO\n\n * Design Node.js services\n * Review code\n\nLocation: Remote, LATAM\n\nOriginally posted on Himalayas',
  'Role type: Contractor\n\nLocation: Remote\n\nOriginally posted on Himalayas',
  'Support customers by email.\n\nOriginally posted on Himalayas',
  '',
  'The same job the company lists on its own board.\n\nOriginally posted on Himalayas',
  'Design things.\n\nOriginally posted on Himalayas',
]

afterEach(() => vi.useRealTimers())

describe('Himalayas normalization', () => {
  it.each(himalayasFixture.jobs.map((posting, index) => ({ posting, index })))('normalizes fixture $index deterministically', ({ posting, index }) => {
    const raw = rawFixture(posting)
    const job = unwrap(himalayasAdapter.normalize(raw, source))
    expect(job).toEqual({
      ...expected[index], description: descriptions[index], applyUrl: posting.applicationLink,
      locationPolicy: 'remote', locationText: null, locationCountry: null, salary: { source: 'unknown' },
    })
    expect(himalayasAdapter.normalize(raw, source)).toEqual({ ok: true, value: job })
  })

  it.each([
    { title: undefined }, { title: '  ' }, { companyName: undefined }, { companyName: '  ' },
    { applicationLink: undefined }, { applicationLink: 'javascript:alert(1)' },
    { guid: 'https://other.example/companies/fixture/jobs/engineer' },
  ])('returns invalid_input without throwing for required fields %j', (fields) => {
    expect(himalayasAdapter.normalize(rawFixture({ ...himalayasFixture.jobs[0], ...fields }), source))
      .toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  })

  it.each([
    { description: 12, locationRestrictions: 'El Salvador', pubDate: 'soon', employmentType: [] },
    { description: undefined, locationRestrictions: undefined, pubDate: undefined, employmentType: undefined },
    { description: null, locationRestrictions: null, pubDate: null, employmentType: null },
    { pubDate: Infinity, locationRestrictions: [] },
    { pubDate: NaN, locationRestrictions: ['Atlantis'] },
  ])('leaves malformed or absent optional fields unknown: %j', (fields) => {
    expect(unwrap(himalayasAdapter.normalize(rawFixture({ ...himalayasFixture.jobs[3], ...fields }), source)))
      .toMatchObject({ description: '', remoteCountries: null, postedAt: null, employmentType: 'unknown' })
  })

  it('trims the payload company name and preserves the application link character for character', () => {
    const applicationLink = 'https://apply.example/Fixture/%2f?utm_source=api&b=2&a=1#Apply'
    const posting = { ...himalayasFixture.jobs[0], companyName: '  Fixture Company  ', applicationLink }
    expect(unwrap(himalayasAdapter.normalize(rawFixture(posting), source))).toMatchObject({ companyName: 'Fixture Company', applyUrl: applicationLink })
  })
})

describe('Himalayas requests', () => {
  it('fetches page one without a pause and keeps every payload verbatim with a shared fetchedAt', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(himalayasFixture))
    const page = unwrap(await himalayasAdapter.fetchPage(source, null, fetcher))
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://himalayas.app/jobs/api/search?country=XT&sort=recent&page=1')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(page.next).toBeNull()
    expect(page.raw.map((raw) => raw.externalId)).toEqual(expected.map((posting) => posting.externalId))
    expect(page.raw.map((raw) => raw.payload)).toEqual(himalayasFixture.jobs)
    expect(new Set(page.raw.map((raw) => raw.fetchedAt)).size).toBe(1)
    expect(page.raw[0]?.fetchedAt).toBeInstanceOf(Date)
  })

  it('continues a full page regardless of the estimated totalCount', async () => {
    const jobs = Array.from({ length: 20 }, (_, index) => ({ ...himalayasFixture.jobs[0], guid: `https://himalayas.app/companies/fixture/jobs/engineer-${index}` }))
    const page = unwrap(await himalayasAdapter.fetchPage(source, null, async () => Response.json({ jobs, totalCount: 1 })))
    expect(page.raw).toHaveLength(20)
    expect(page.next).toBe('2')
  })

  it('waits 1,500 ms before requesting page two', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(himalayasFixture))
    const pending = himalayasAdapter.fetchPage(source, '2', fetcher)
    expect(fetcher).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_499)
    expect(fetcher).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(unwrap(await pending).next).toBeNull()
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://himalayas.app/jobs/api/search?country=XT&sort=recent&page=2')
  })

  it.each(['0', 'abc', '2.5', '', '-1'])('rejects cursor %j without requesting', async (cursor) => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await himalayasAdapter.fetchPage(source, cursor, fetcher)).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('stops at the page cap without waiting or requesting', async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await himalayasAdapter.fetchPage(source, '501', fetcher))
      .toMatchObject({ ok: false, error: { code: 'upstream_failed', message: 'Himalayas returned more than 500 pages.' } })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['sv', 'USA'])('rejects country token %s without requesting', async (token) => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await himalayasAdapter.fetchPage({ ...source, config: { token } }, null, fetcher))
      .toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([{}, { jobs: [{ guid: 'https://other.example/companies/fixture/jobs/engineer' }] }])('rejects a malformed page %j', async (envelope) => {
    expect(await himalayasAdapter.fetchPage(source, null, async () => Response.json(envelope)))
      .toMatchObject({ ok: false, error: { code: 'validation_failed' } })
  })

  it('returns upstream_failed for HTTP 500 and thrown fetch errors', async () => {
    expect(await himalayasAdapter.fetchPage(source, null, async () => new Response(null, { status: 500 })))
      .toMatchObject({ ok: false, error: { code: 'upstream_failed' } })
    expect(await himalayasAdapter.fetchPage(source, null, async () => { throw new Error('unreachable') }))
      .toMatchObject({ ok: false, error: { code: 'upstream_failed' } })
  })
})

describe('Himalayas health', () => {
  it('checks page one without a pause and requires at least one posting', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(himalayasFixture))
    expect(await himalayasAdapter.health(source, fetcher)).toEqual({ ok: true, checkedAt: expect.any(Date) })
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://himalayas.app/jobs/api/search?country=XT&sort=recent&page=1')
    expect(await himalayasAdapter.health(source, async () => Response.json({ jobs: [] })))
      .toEqual({ ok: false, checkedAt: expect.any(Date), message: 'No jobs listed for this country code.' })
  })

  it('explains an invalid token without requesting', async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await himalayasAdapter.health({ ...source, config: { token: 'sv' } }, fetcher))
      .toEqual({ ok: false, checkedAt: expect.any(Date), message: 'Use a two-letter country code, such as SV.' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports the request error message', async () => {
    expect(await himalayasAdapter.health(source, async () => new Response(null, { status: 500 })))
      .toMatchObject({ ok: false, message: 'HTTP 500' })
    expect(await himalayasAdapter.health(source, async () => { throw new Error('unreachable') }))
      .toMatchObject({ ok: false, message: 'Source request failed or timed out.' })
  })
})
