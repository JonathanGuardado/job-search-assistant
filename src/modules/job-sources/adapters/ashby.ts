import { z } from 'zod'
import { domainError, err, ok } from '@/lib/result'
import type { JobSourceAdapter, NormalizedJob, NormalizedSalary } from '../adapter.js'
import { htmlToPlainText } from '../html-text.js'
import { getJson } from '../http.js'
import { annualSalary } from '../salary.js'

const PageSchema = z.looseObject({ jobs: z.array(z.looseObject({ id: z.string().min(1) })) })
const optionalText = z.string().nullish().catch(null)
const CompensationSchema = z.looseObject({
  summaryComponents: z.array(z.looseObject({
    compensationType: z.string(), interval: optionalText,
    currencyCode: z.unknown().optional(), minValue: z.unknown().optional(), maxValue: z.unknown().optional(),
  })).nullish(),
}).nullish().catch(null)
const PostingSchema = z.looseObject({
  id: z.string().min(1), title: z.string().trim().min(1), jobUrl: z.url({ protocol: /^https?$/ }),
  applyUrl: z.url({ protocol: /^https?$/ }).optional(),
  descriptionHtml: optionalText, descriptionPlain: optionalText, location: optionalText,
  // Keep malformed entries in the count: they cannot establish a single-country posting.
  secondaryLocations: z.array(z.looseObject({ location: optionalText }).catch({ location: null })).nullish().catch(null),
  workplaceType: z.enum(['Remote', 'Hybrid', 'OnSite']).nullish().catch(null),
  employmentType: optionalText, publishedAt: optionalText,
  address: z.looseObject({
    postalAddress: z.looseObject({ addressCountry: optionalText }).nullish().catch(null),
  }).nullish().catch(null),
  compensation: CompensationSchema,
})

function salaryFromCompensation(compensation: z.infer<typeof CompensationSchema>): NormalizedSalary {
  const salaries = compensation?.summaryComponents?.filter((component) => component.compensationType === 'Salary') ?? []
  const [salary] = salaries
  if (salaries.length !== 1 || !salary || salary.interval !== '1 YEAR') return { source: 'unknown' }
  return annualSalary(salary.minValue, salary.maxValue, salary.currencyCode)
}

function workplacePolicy(value: z.infer<typeof PostingSchema>['workplaceType']): NormalizedJob['locationPolicy'] {
  switch (value) {
    case 'Remote': return 'remote'
    case 'Hybrid': return 'hybrid'
    case 'OnSite': return 'onsite'
    default: return 'unknown'
  }
}

export const ashbyAdapter: JobSourceAdapter = {
  key: 'ashby', kind: 'ats', volatileKeys: [],
  async fetchPage(source, cursor, fetcher) {
    if (cursor !== null) return err(domainError('invalid_input', 'Ashby boards have one page.'))
    const fetched = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${source.config.token}?includeCompensation=true`, PageSchema, fetcher)
    if (!fetched.ok) return fetched
    const fetchedAt = new Date()
    return ok({ raw: fetched.value.jobs.filter((posting) => posting.isListed !== false).map((payload) => ({ externalId: payload.id, payload, fetchedAt })), next: null })
  },
  normalize(raw, source) {
    const parsed = PostingSchema.safeParse(raw.payload)
    if (!parsed.success) return err(domainError('invalid_input', `Posting ${raw.externalId}: invalid ${parsed.error.issues[0]?.path.join('.') ?? 'payload'}`))
    const posting = parsed.data
    const locations = [posting.location, ...(posting.secondaryLocations ?? []).map((secondary) => secondary.location)]
      .map((location) => location?.trim() ?? '').filter(Boolean)
    const country = posting.address?.postalAddress?.addressCountry
    const published = typeof posting.publishedAt === 'string' ? new Date(posting.publishedAt) : null
    return ok<NormalizedJob>({
      externalId: posting.id, companyName: source.name, title: posting.title,
      description: posting.descriptionHtml ? htmlToPlainText(posting.descriptionHtml) : posting.descriptionPlain?.trim() ?? '',
      locationPolicy: workplacePolicy(posting.workplaceType), locationText: [...new Set(locations)].join('; ') || null,
      locationCountry: country && /^[A-Z]{2}$/.test(country) && posting.secondaryLocations?.length === 0 ? country : null,
      employmentType: posting.employmentType === 'Contract' ? 'contractor' : 'unknown',
      salary: salaryFromCompensation(posting.compensation), applyUrl: posting.applyUrl ?? posting.jobUrl,
      postedAt: published && Number.isFinite(published.getTime()) ? published : null,
    })
  },
  async health(source, fetcher) {
    const checkedAt = new Date()
    const result = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${source.config.token}`, z.looseObject({ jobs: z.array(z.unknown()) }), fetcher)
    return result.ok ? { ok: true, checkedAt } : {
      ok: false, checkedAt, message: result.error.code === 'not_found' ? 'Board not found' : result.error.message,
    }
  },
}
