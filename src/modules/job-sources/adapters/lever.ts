import { z } from 'zod'
import { domainError, err, ok } from '@/lib/result'
import type { JobSourceAdapter, NormalizedJob, NormalizedSalary } from '../adapter.js'
import { htmlToPlainText } from '../html-text.js'
import { getJson } from '../http.js'

export const LEVER_PAGE_SIZE = 100
const PageSchema = z.array(z.looseObject({ id: z.string().min(1) }))
// Optional numbers are narrowed at mapping time, so a malformed one (e.g. "85000") makes
// that value unknown instead of rejecting the whole posting.
const SalaryRangeSchema = z.object({ min: z.unknown().optional(), max: z.unknown().optional(), currency: z.string().optional(), interval: z.string().optional() })
const PostingSchema = z.looseObject({
  id: z.string().min(1), text: z.string().trim().min(1), descriptionPlain: z.string().default(''),
  lists: z.array(z.object({ text: z.string(), content: z.string() })).default([]), additionalPlain: z.string().default(''),
  categories: z.object({ location: z.string().optional(), commitment: z.string().optional() }).optional(),
  workplaceType: z.string().optional(), country: z.string().nullable().optional(),
  salaryRange: SalaryRangeSchema.nullable().optional(), applyUrl: z.url().optional(), hostedUrl: z.url(), createdAt: z.unknown().optional(),
})

/** undefined: absent. null: present but not a usable amount. */
function salaryBound(value: unknown): number | undefined | null {
  if (value === undefined || value === null) return undefined
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function salaryFromRange(range: z.infer<typeof SalaryRangeSchema> | null | undefined): NormalizedSalary {
  if (!range || range.interval !== 'per-year-salary' || !range.currency || !/^[A-Z]{3}$/.test(range.currency)) return { source: 'unknown' }
  const { currency } = range
  const min = salaryBound(range.min)
  const max = salaryBound(range.max)
  if (min === null || max === null || (min === undefined && max === undefined)) return { source: 'unknown' }
  if (min !== undefined && max !== undefined && min > max) return { source: 'unknown' }
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  const minor = (bound: number | undefined) => bound === undefined ? null : Math.round(bound * 10 ** digits)
  const minMinor = minor(min)
  const maxMinor = minor(max)
  if ([minMinor, maxMinor].some((bound) => bound !== null && !Number.isSafeInteger(bound))) return { source: 'unknown' }
  return { source: 'posted', minMinor, maxMinor, currency }
}

function workplacePolicy(value: string | undefined): NormalizedJob['locationPolicy'] {
  return value === 'remote' || value === 'hybrid' || value === 'onsite' ? value : 'unknown'
}

export const leverAdapter: JobSourceAdapter = {
  key: 'lever', kind: 'ats',
  async fetchPage(source, cursor, fetcher) {
    if (cursor !== null && !/^\d+$/.test(cursor)) return err(domainError('invalid_input', 'Lever cursor must be a decimal offset.'))
    const skip = cursor === null ? 0 : Number(cursor)
    if (!Number.isSafeInteger(skip) || !Number.isSafeInteger(skip + LEVER_PAGE_SIZE)) return err(domainError('invalid_input', 'Lever cursor exceeds the supported offset.'))
    const fetched = await getJson(`https://api.lever.co/v0/postings/${source.config.token}?mode=json&skip=${skip}&limit=100`, PageSchema, fetcher)
    if (!fetched.ok) return fetched
    const fetchedAt = new Date()
    return ok({ raw: fetched.value.map((payload) => ({ externalId: payload.id, payload, fetchedAt })), next: fetched.value.length === LEVER_PAGE_SIZE ? String(skip + LEVER_PAGE_SIZE) : null })
  },
  normalize(raw, source) {
    const parsed = PostingSchema.safeParse(raw.payload)
    if (!parsed.success) return err(domainError('invalid_input', `Posting ${raw.externalId}: invalid ${parsed.error.issues[0]?.path.join('.') ?? 'payload'}`))
    const posting = parsed.data
    const commitment = posting.categories?.commitment ?? ''
    const published = typeof posting.createdAt === 'number' ? new Date(posting.createdAt) : null
    return ok<NormalizedJob>({
      externalId: posting.id, companyName: source.name, title: posting.text,
      description: [posting.descriptionPlain, ...posting.lists.map((list) => `${list.text.trim()}\n${htmlToPlainText(`<ul>${list.content}</ul>`)}`), posting.additionalPlain]
        .map((part) => part.trim()).filter(Boolean).join('\n\n'),
      locationPolicy: workplacePolicy(posting.workplaceType), locationText: posting.categories?.location?.trim() || null,
      locationCountry: posting.country && /^[A-Z]{2}$/.test(posting.country) ? posting.country : null,
      employmentType: /\bcontract(or)?\b/i.test(commitment) && !/fixed[\s-]term/i.test(commitment) ? 'contractor' : 'unknown',
      salary: salaryFromRange(posting.salaryRange), applyUrl: posting.applyUrl ?? posting.hostedUrl,
      postedAt: published && Number.isFinite(published.getTime()) ? published : null,
    })
  },
  async health(source, fetcher) {
    const checkedAt = new Date()
    const result = await getJson(`https://api.lever.co/v0/postings/${source.config.token}?mode=json&limit=1`, z.array(z.unknown()), fetcher)
    return result.ok ? { ok: true, checkedAt } : {
      ok: false, checkedAt, message: result.error.code === 'not_found' ? 'Site not found' : result.error.message,
    }
  },
}
