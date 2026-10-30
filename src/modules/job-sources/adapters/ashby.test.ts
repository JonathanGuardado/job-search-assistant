import { describe, expect, it, vi } from 'vitest'
import { unwrap } from '@/lib/result'
import { ashbyFixture, fixtureSource, rawFixture } from '../test-fixtures.js'
import { ashbyAdapter } from './ashby.js'

const expected = [
  { externalId: '54bbf446-8b59-419d-b52e-035ed06fa645', title: 'Principal Database Performance Engineer - Core Engineering (C++)', locationPolicy: 'remote', locationText: 'Germany; United Kingdom; Spain; The Netherlands', locationCountry: null, employmentType: 'unknown', salary: { source: 'unknown' }, postedAt: new Date('2026-09-17T00:20:07.216Z') },
  { externalId: 'dc0ec843-13a4-4032-9992-7e7a924228c8', title: 'Senior Product Manager, Billing & Marketplaces', locationPolicy: 'hybrid', locationText: 'Europe; Portugal; France; United Kingdom; Italy; Israel; The Netherlands', locationCountry: null, employmentType: 'unknown', salary: { source: 'unknown' }, postedAt: new Date('2026-10-17T01:32:48.831Z') },
  { externalId: '47e36408-41dd-4631-af71-3630bf386f2f', title: 'Agente de Servicio al Cliente | Programa de Inclusión', locationPolicy: 'onsite', locationText: 'Bogotá', locationCountry: 'CO', employmentType: 'unknown', salary: { source: 'unknown' }, postedAt: new Date('2026-07-18T02:45:00.530Z') },
  { externalId: 'a069c886-1107-408e-88b4-e1aa8d33d4bc', title: 'Account Executive (EMEA)', locationPolicy: 'unknown', locationText: 'Remote, EMEA; Europe', locationCountry: null, employmentType: 'unknown', salary: { source: 'unknown' }, postedAt: new Date('2026-08-26T19:59:56.317Z') },
  { externalId: '7f318f1d-6787-4cbe-b20b-59169fcfd048', title: 'Senior Back-End Developer (Java) - Global Insights & Strategy', locationPolicy: 'remote', locationText: 'LatAm', locationCountry: null, employmentType: 'contractor', salary: { source: 'unknown' }, postedAt: new Date('2026-10-13T20:24:53.886Z') },
  { externalId: 'da6f6da1-eabf-4647-ab1c-6e138b14a6fe', title: 'Sr. Frontend Software Engineer - Growth', locationPolicy: 'remote', locationText: 'United States', locationCountry: null, employmentType: 'unknown', salary: { source: 'posted', minMinor: 18500000, maxMinor: 23000000, currency: 'USD' }, postedAt: new Date('2026-10-27T20:00:19.146Z') },
  { externalId: 'a13ae586-f4cb-4385-8822-c42b9b54ed74', title: 'Software Engineering Intern, Frontend', locationPolicy: 'hybrid', locationText: 'New York, NY (HQ)', locationCountry: null, employmentType: 'unknown', salary: { source: 'unknown' }, postedAt: new Date('2026-09-24T00:40:15.975Z') },
  { externalId: '863956bc-9a2e-4531-ba9e-45c409e4f1ca', title: 'Senior Software Engineer - Integrations - AI/ML', locationPolicy: 'remote', locationText: 'United States', locationCountry: null, employmentType: 'unknown', salary: { source: 'posted', minMinor: 14700000, maxMinor: 23800000, currency: 'USD' }, postedAt: new Date('2026-07-09T12:23:47.348Z') },
]

const annualComponent = { compensationType: 'Salary', interval: '1 YEAR', currencyCode: 'USD', minValue: 85000, maxValue: 175000 }

describe('Ashby normalization', () => {
  it.each(ashbyFixture.jobs.map((posting, index) => ({ posting, expected: expected[index] })))('normalizes fixture $posting.id deterministically', ({ posting, expected: row }) => {
    expect(row).toBeDefined()
    const raw = rawFixture(posting, posting.id)
    const job = unwrap(ashbyAdapter.normalize(raw, fixtureSource))
    expect(job).toMatchObject({ ...row, companyName: 'Fixture Co', applyUrl: posting.applyUrl })
    expect(job.description).not.toMatch(/<|&lt;/)
    if (posting.id === '47e36408-41dd-4631-af71-3630bf386f2f') expect(job.description).toBe('')
    else expect(job.description.length).toBeGreaterThan(0)
    expect(ashbyAdapter.normalize(raw, fixtureSource)).toEqual({ ok: true, value: job })
  })

  it('does not infer a workplace policy from isRemote', () => {
    const posting = { ...ashbyFixture.jobs[0], workplaceType: null, isRemote: true }
    expect(unwrap(ashbyAdapter.normalize(rawFixture(posting), fixtureSource)).locationPolicy).toBe('unknown')
  })

  it.each([
    { summaryComponents: [annualComponent, annualComponent] },
    { summaryComponents: [{ ...annualComponent, interval: '1 HOUR' }] },
    { summaryComponents: [{ ...annualComponent, currencyCode: 'usd' }] },
    { summaryComponents: [{ ...annualComponent, currencyCode: null }] },
    { summaryComponents: [{ ...annualComponent, minValue: '85000' }] },
    { summaryComponents: [{ ...annualComponent, minValue: 200000 }] },
    undefined,
    null,
    'garbage',
    { summaryComponents: 'garbage' },
    { summaryComponents: [annualComponent, null] },
    { summaryComponents: [{ ...annualComponent, compensationType: 'Bonus' }] },
  ])('keeps ambiguous or malformed compensation unknown: %j', (compensation) => {
    const posting = { ...ashbyFixture.jobs[0], compensation }
    expect(unwrap(ashbyAdapter.normalize(rawFixture(posting), fixtureSource)).salary).toEqual({ source: 'unknown' })
  })

  it('converts the only annual Salary component while ignoring other compensation types', () => {
    const compensation = { summaryComponents: [annualComponent, { compensationType: 'EquityPercentage' }] }
    const posting = { ...ashbyFixture.jobs[0], compensation }
    expect(unwrap(ashbyAdapter.normalize(rawFixture(posting), fixtureSource)).salary)
      .toEqual({ source: 'posted', minMinor: 8500000, maxMinor: 17500000, currency: 'USD' })
  })

  it('uses jobUrl and unknown values when optional fields are absent', () => {
    const posting = { id: 'minimal', title: ' Engineer (Remote) ', jobUrl: 'https://jobs.ashbyhq.com/fixture/minimal' }
    expect(unwrap(ashbyAdapter.normalize(rawFixture(posting), fixtureSource))).toEqual({
      externalId: 'minimal', companyName: 'Fixture Co', title: 'Engineer (Remote)', description: '',
      applyUrl: posting.jobUrl, locationPolicy: 'unknown', locationCountry: null, locationText: null,
      employmentType: 'unknown', salary: { source: 'unknown' }, postedAt: null,
    })
  })

  it('falls back to trimmed plain text when HTML is empty', () => {
    const posting = { ...ashbyFixture.jobs[0], descriptionHtml: '', descriptionPlain: '  Plain description\n  ' }
    expect(unwrap(ashbyAdapter.normalize(rawFixture(posting), fixtureSource)).description).toBe('Plain description')
  })

  it('prefers HTML over differently cased plain text', () => {
    const posting = { ...ashbyFixture.jobs[0], descriptionHtml: '<p>Keep this casing &amp; text.</p>', descriptionPlain: 'KEEP THIS CASING & TEXT.' }
    expect(unwrap(ashbyAdapter.normalize(rawFixture(posting), fixtureSource)).description).toBe('Keep this casing & text.')
  })

  it('trims and deduplicates locations in first-seen order', () => {
    const posting = { ...ashbyFixture.jobs[0], location: ' Bogotá ', secondaryLocations: [{ location: null }, { location: ' Bogotá' }, { location: ' ' }, { location: ' Medellín ' }, { location: 'Medellín' }] }
    expect(unwrap(ashbyAdapter.normalize(rawFixture(posting), fixtureSource)).locationText).toBe('Bogotá; Medellín')
  })

  it('leaves an absent location, a country name and an invalid timestamp unknown', () => {
    const posting = { ...ashbyFixture.jobs[0], location: null, secondaryLocations: [], address: { postalAddress: { addressCountry: 'Colombia' } }, publishedAt: 'not-a-date' }
    expect(unwrap(ashbyAdapter.normalize(rawFixture(posting), fixtureSource)))
      .toMatchObject({ locationText: null, locationCountry: null, postedAt: null })
  })

  it.each(['Colombia', 'USA', 'co', ' CO '])('does not convert country %s into an ISO code', (addressCountry) => {
    const posting = { ...ashbyFixture.jobs[0], secondaryLocations: [], address: { postalAddress: { addressCountry } } }
    expect(unwrap(ashbyAdapter.normalize(rawFixture(posting), fixtureSource)).locationCountry).toBeNull()
  })

  it.each([
    { secondaryLocations: [{ location: 'Medellín' }] },
    { secondaryLocations: [{ location: null }] },
    { secondaryLocations: [null] },
    { secondaryLocations: 'garbage' },
  ])('does not assign a single country with secondary locations $secondaryLocations', ({ secondaryLocations }) => {
    const posting = { ...ashbyFixture.jobs[0], secondaryLocations, address: { postalAddress: { addressCountry: 'CO' } } }
    expect(unwrap(ashbyAdapter.normalize(rawFixture(posting), fixtureSource)).locationCountry).toBeNull()
  })

  it.each([
    { fields: { workplaceType: 12 }, value: { locationPolicy: 'unknown' } },
    { fields: { workplaceType: 'remote' }, value: { locationPolicy: 'unknown' } },
    { fields: { employmentType: [] }, value: { employmentType: 'unknown' } },
    { fields: { employmentType: 'FullTime' }, value: { employmentType: 'unknown' } },
    { fields: { location: 12, secondaryLocations: [] }, value: { locationText: null } },
    { fields: { location: ' Bogotá ', secondaryLocations: [null, { location: 12 }, { location: ' Medellín ' }] }, value: { locationText: 'Bogotá; Medellín' } },
    { fields: { address: 'garbage' }, value: { locationCountry: null } },
    { fields: { address: { postalAddress: { addressCountry: 12 } } }, value: { locationCountry: null } },
    { fields: { publishedAt: 123 }, value: { postedAt: null } },
    { fields: { descriptionHtml: {}, descriptionPlain: '  Plain fallback  ' }, value: { description: 'Plain fallback' } },
    { fields: { descriptionHtml: null, descriptionPlain: [] }, value: { description: '' } },
  ])('keeps only malformed optional values unknown: $fields', ({ fields, value }) => {
    const posting = { ...ashbyFixture.jobs[0], ...fields }
    expect(unwrap(ashbyAdapter.normalize(rawFixture(posting), fixtureSource))).toMatchObject({ ...value, externalId: ashbyFixture.jobs[0]?.id })
  })

  it('accepts null optional fields without rejecting the posting', () => {
    const posting = { ...ashbyFixture.jobs[0], descriptionHtml: null, descriptionPlain: null, location: null, secondaryLocations: null, address: null, workplaceType: null, employmentType: null, publishedAt: null, compensation: null }
    expect(unwrap(ashbyAdapter.normalize(rawFixture(posting), fixtureSource))).toMatchObject({
      description: '', locationPolicy: 'unknown', locationText: null, locationCountry: null,
      employmentType: 'unknown', salary: { source: 'unknown' }, postedAt: null,
    })
  })

  it('reports malformed postings with the external id and field path', () => {
    expect(ashbyAdapter.normalize(rawFixture({ id: 'x' }, 'x'), fixtureSource))
      .toMatchObject({ ok: false, error: { code: 'invalid_input', message: 'Posting x: invalid title' } })
  })

  it.each([
    { fields: { id: '' }, path: 'id' },
    { fields: { title: '  ' }, path: 'title' },
    { fields: { jobUrl: 'javascript:alert(1)' }, path: 'jobUrl' },
    { fields: { jobUrl: undefined }, path: 'jobUrl' },
    { fields: { applyUrl: 'javascript:alert(1)' }, path: 'applyUrl' },
    { fields: { applyUrl: null }, path: 'applyUrl' },
  ])('rejects invalid $path', ({ fields, path }) => {
    const posting = { ...ashbyFixture.jobs[0], ...fields }
    expect(ashbyAdapter.normalize(rawFixture(posting, 'invalid-posting'), fixtureSource))
      .toMatchObject({ ok: false, error: { code: 'invalid_input', message: `Posting invalid-posting: invalid ${path}` } })
  })
})

describe('Ashby requests', () => {
  it('fetches the exact URL, preserves payloads verbatim and drops only unlisted jobs', async () => {
    const jobs = [
      ...ashbyFixture.jobs,
      { ...ashbyFixture.jobs[0], id: 'unlisted', isListed: false },
      { id: 'missing-listing-flag', futureField: { preserved: true } },
      { id: 'null-listing-flag', isListed: null },
      { id: 'malformed-listing-flag', isListed: 'false' },
    ]
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...ashbyFixture, futureEnvelopeField: true, jobs }))
    const page = unwrap(await ashbyAdapter.fetchPage(fixtureSource, null, fetcher))
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.ashbyhq.com/posting-api/job-board/fixture?includeCompensation=true')
    expect(page.next).toBeNull()
    const listed = jobs.filter((job) => !('isListed' in job) || job.isListed !== false)
    expect(page.raw.map((raw) => raw.externalId)).toEqual(listed.map((job) => job.id))
    expect(page.raw.map((raw) => raw.payload)).toEqual(listed)
    expect(new Set(page.raw.map((raw) => raw.fetchedAt)).size).toBe(1)
    expect(page.raw[0]?.fetchedAt).toBeInstanceOf(Date)
  })

  it('accepts an empty board as the final page', async () => {
    expect(unwrap(await ashbyAdapter.fetchPage(fixtureSource, null, async () => Response.json({ jobs: [] }))))
      .toEqual({ raw: [], next: null })
  })

  it.each(['', '0', '100', 'next'])('rejects cursor %j before fetching', async (cursor) => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await ashbyAdapter.fetchPage(fixtureSource, cursor, fetcher))
      .toMatchObject({ ok: false, error: { code: 'invalid_input', message: 'Ashby boards have one page.' } })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([[404, 'not_found'], [500, 'upstream_failed']])('maps HTTP %s to %s', async (status, code) => {
    expect(await ashbyAdapter.fetchPage(fixtureSource, null, async () => new Response(null, { status })))
      .toMatchObject({ ok: false, error: { code } })
  })

  it('returns upstream_failed for a thrown fetch', async () => {
    expect(await ashbyAdapter.fetchPage(fixtureSource, null, async () => { throw new Error('secret') }))
      .toMatchObject({ ok: false, error: { code: 'upstream_failed' } })
  })

  it.each([{ postings: [] }, { jobs: [{}] }, { jobs: [{ id: '' }] }])('rejects a malformed envelope %j', async (envelope) => {
    expect(await ashbyAdapter.fetchPage(fixtureSource, null, async () => Response.json(envelope)))
      .toMatchObject({ ok: false, error: { code: 'validation_failed' } })
  })

  it('checks health at the URL without compensation, accepting an empty board', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ apiVersion: '1', jobs: [] }))
    expect(await ashbyAdapter.health(fixtureSource, fetcher)).toEqual({ ok: true, checkedAt: expect.any(Date) })
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.ashbyhq.com/posting-api/job-board/fixture')
    expect(await ashbyAdapter.health(fixtureSource, async () => Response.json({ jobs: [null] }))).toMatchObject({ ok: true })
  })

  it('reports missing and unreachable boards without throwing', async () => {
    expect(await ashbyAdapter.health(fixtureSource, async () => new Response(null, { status: 404 })))
      .toEqual({ ok: false, checkedAt: expect.any(Date), message: 'Board not found' })
    expect(await ashbyAdapter.health(fixtureSource, async () => new Response(null, { status: 500 })))
      .toMatchObject({ ok: false, message: 'HTTP 500' })
    expect(await ashbyAdapter.health(fixtureSource, async () => { throw new Error('secret') }))
      .toMatchObject({ ok: false, message: 'Source request failed or timed out.' })
    expect(await ashbyAdapter.health(fixtureSource, async () => Response.json({ postings: [] })))
      .toMatchObject({ ok: false, message: 'Source response did not match the expected JSON schema.' })
  })
})
