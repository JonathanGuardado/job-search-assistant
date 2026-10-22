import { z } from 'zod'
import { domainError, err, ok } from '@/lib/result'
import type { JobSourceAdapter, NormalizedJob } from '../adapter.js'
import { htmlToPlainText } from '../html-text.js'
import { getJson } from '../http.js'

const JobsSchema = z.object({ jobs: z.array(z.looseObject({ id: z.number().int() })) })
const PostingSchema = z.looseObject({
  id: z.number().int(), title: z.string().trim().min(1), content: z.string(), absolute_url: z.url({ protocol: /^https?$/ }),
  location: z.object({ name: z.string() }).nullable().optional(),
  first_published: z.string().nullable().optional(),
})

function classifyLocationText(text: string | null): NormalizedJob['locationPolicy'] {
  if (text === null || /\b(non|not)[\s-]remote\b/i.test(text)) return 'unknown'
  const hybrid = /\bhybrid\b/i.test(text)
  const remote = /\bremote\b|\bhome[\s-]based\b/i.test(text)
  if (hybrid && remote) return 'unknown'
  return hybrid ? 'hybrid' : remote ? 'remote' : 'unknown'
}

export const greenhouseAdapter: JobSourceAdapter = {
  key: 'greenhouse', kind: 'ats', volatileKeys: ['updated_at'],
  async fetchPage(source, cursor, fetcher) {
    if (cursor !== null) return err(domainError('invalid_input', 'Greenhouse does not accept a page cursor.'))
    const fetched = await getJson(`https://boards-api.greenhouse.io/v1/boards/${source.config.token}/jobs?content=true&pay_transparency=true`, JobsSchema, fetcher)
    if (!fetched.ok) return fetched
    const fetchedAt = new Date()
    return ok({ raw: fetched.value.jobs.map((payload) => ({ externalId: String(payload.id), payload, fetchedAt })), next: null })
  },
  normalize(raw, source) {
    const parsed = PostingSchema.safeParse(raw.payload)
    if (!parsed.success) return err(domainError('invalid_input', `Posting ${raw.externalId}: invalid ${parsed.error.issues[0]?.path.join('.') ?? 'payload'}`))
    const posting = parsed.data
    const locationText = posting.location?.name.trim() || null
    const published = posting.first_published ? new Date(posting.first_published) : null
    return ok<NormalizedJob>({
      externalId: String(posting.id), companyName: source.name, title: posting.title,
      // The first pass decodes escaped tags; the second renders the decoded HTML.
      description: htmlToPlainText(htmlToPlainText(posting.content)),
      locationPolicy: classifyLocationText(locationText), locationText, locationCountry: null,
      employmentType: 'unknown', salary: { source: 'unknown' }, applyUrl: posting.absolute_url,
      postedAt: published && Number.isFinite(published.getTime()) ? published : null,
    })
  },
  async health(source, fetcher) {
    const checkedAt = new Date()
    const result = await getJson(`https://boards-api.greenhouse.io/v1/boards/${source.config.token}`, z.object({ name: z.string() }), fetcher)
    return result.ok ? { ok: true, checkedAt } : {
      ok: false, checkedAt, message: result.error.code === 'not_found' ? 'Board not found' : result.error.message,
    }
  },
}
