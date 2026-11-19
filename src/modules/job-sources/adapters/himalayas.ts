import { z } from 'zod'
import { domainError, err, ok } from '@/lib/result'
import type { JobSourceAdapter, NormalizedJob } from '../adapter.js'
import { countryCodeOf } from '../country-names.js'
import { htmlToPlainText } from '../html-text.js'
import { getJson } from '../http.js'

const GUID_PATTERN = /^https:\/\/himalayas\.app\/companies\/([^/]+)\/jobs\/([^/]+)$/
const GuidSchema = z.string().regex(GUID_PATTERN)
const CountrySchema = z.string().regex(/^[A-Z]{2}$/)
const CursorSchema = z.string().regex(/^[1-9]\d*$/)
const PageSchema = z.looseObject({ jobs: z.array(z.looseObject({ guid: GuidSchema })) })
const optionalText = z.string().nullish().catch(null)
const PostingSchema = z.looseObject({
  guid: GuidSchema, companyName: z.string().trim().min(1), title: z.string().trim().min(1),
  applicationLink: z.url({ protocol: /^https?$/ }),
  description: optionalText, employmentType: optionalText,
  locationRestrictions: z.array(z.string()).nullish().catch(null),
  pubDate: z.number().nullish().catch(null),
})
const PAGE_PAUSE_MS = 1_500
const COUNTRY_HINT = 'Use a two-letter country code, such as SV.'

const externalIdOf = (guid: string): string => guid.replace(GUID_PATTERN, '$1/$2')

export const himalayasAdapter: JobSourceAdapter = {
  key: 'himalayas', kind: 'board', volatileKeys: [], pollEveryMs: 24 * 60 * 60_000,
  credit: { name: 'Himalayas', url: 'https://himalayas.app' },
  async fetchPage(source, cursor, fetcher) {
    if (!CountrySchema.safeParse(source.config.token).success) return err(domainError('invalid_input', COUNTRY_HINT))
    if (cursor !== null && !CursorSchema.safeParse(cursor).success) return err(domainError('invalid_input', 'Himalayas requires a positive integer page number.'))
    const page = cursor === null ? 1 : Number(cursor)
    if (page > 500) return err(domainError('upstream_failed', 'Himalayas returned more than 500 pages.'))
    if (cursor !== null) await new Promise((resolve) => setTimeout(resolve, PAGE_PAUSE_MS))
    const fetched = await getJson(`https://himalayas.app/jobs/api/search?country=${source.config.token}&sort=recent&page=${page}`, PageSchema, fetcher)
    if (!fetched.ok) return fetched
    const fetchedAt = new Date()
    return ok({
      raw: fetched.value.jobs.map((payload) => ({ externalId: externalIdOf(payload.guid), payload, fetchedAt })),
      next: fetched.value.jobs.length >= 20 ? String(page + 1) : null,
    })
  },
  normalize(raw) {
    const parsed = PostingSchema.safeParse(raw.payload)
    if (!parsed.success) return err(domainError('invalid_input', `Posting ${raw.externalId}: invalid ${parsed.error.issues[0]?.path.join('.') ?? 'payload'}`))
    const posting = parsed.data
    const countries = [...new Set((posting.locationRestrictions ?? []).flatMap((name) => countryCodeOf(name) ?? []))]
    return ok<NormalizedJob>({
      externalId: externalIdOf(posting.guid), companyName: posting.companyName, title: posting.title,
      description: posting.description ? htmlToPlainText(posting.description) : '',
      locationPolicy: 'remote', locationText: null, locationCountry: null,
      remoteCountries: countries.length > 0 ? countries : null,
      employmentType: posting.employmentType === 'Contractor' ? 'contractor' : 'unknown',
      salary: { source: 'unknown' }, applyUrl: posting.applicationLink,
      postedAt: typeof posting.pubDate === 'number' ? new Date(posting.pubDate * 1000) : null,
    })
  },
  async health(source, fetcher) {
    const checkedAt = new Date()
    const result = await himalayasAdapter.fetchPage(source, null, fetcher)
    if (!result.ok) return { ok: false, checkedAt, message: result.error.message }
    return result.value.raw.length > 0 ? { ok: true, checkedAt }
      : { ok: false, checkedAt, message: 'No jobs listed for this country code.' }
  },
}
