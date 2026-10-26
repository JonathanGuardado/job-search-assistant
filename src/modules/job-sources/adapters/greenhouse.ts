import { z } from 'zod'
import { domainError, err, ok, type Result } from '@/lib/result'
import type { ApplicationForm, FormField, FormQuestion, JobSourceAdapter, NormalizedJob } from '../adapter.js'
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

// The application form, from /jobs/<id>?questions=true. Every section shares one question shape.
// input_hidden: the location widget's latitude and longitude, set when a city is picked.
const FIELD_TYPES: Readonly<Record<string, FormField['type']>> = {
  input_text: 'text', textarea: 'textarea', input_file: 'file',
  multi_value_single_select: 'single_select', multi_value_multi_select: 'multi_select', input_hidden: 'hidden',
}
const GreenhouseQuestionSchema = z.object({
  label: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  required: z.boolean().nullable().optional(),
  fields: z.array(z.object({
    name: z.string().min(1),
    type: z.string(),
    values: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]) })).nullable().optional(),
  })).min(1),
})
const GreenhouseFormSchema = z.looseObject({
  questions: z.array(GreenhouseQuestionSchema),
  location_questions: z.array(GreenhouseQuestionSchema).nullable().optional(),
  compliance: z.array(z.looseObject({ questions: z.array(GreenhouseQuestionSchema).nullable().optional() })).nullable().optional(),
  demographic_questions: z.unknown().optional(),
})

function readQuestion(question: z.infer<typeof GreenhouseQuestionSchema>, section: FormQuestion['section']): Result<FormQuestion> {
  const fields: FormField[] = []
  for (const field of question.fields) {
    const type = FIELD_TYPES[field.type]
    // An unknown field could be required: refusing the form beats marking it fillable.
    if (type === undefined) return err(domainError('invalid_input', `Question "${question.label}" has an unsupported field type "${field.type}".`))
    fields.push({ name: field.name, type, options: (field.values ?? []).map((v) => ({ label: v.label, value: String(v.value) })) })
  }
  const description = question.description ? htmlToPlainText(htmlToPlainText(question.description)) || null : null
  return ok({ label: question.label, description, required: question.required === true, section, fields })
}

function readApplicationForm(payload: unknown): Result<ApplicationForm> {
  const parsed = GreenhouseFormSchema.safeParse(payload)
  if (!parsed.success) return err(domainError('invalid_input', `Application form: invalid ${parsed.error.issues[0]?.path.join('.') ?? 'payload'}`))
  const form = parsed.data
  // Greenhouse's newer demographic section has its own shape; until a real one is captured, a form using it cannot be read.
  if (form.demographic_questions !== null && form.demographic_questions !== undefined) {
    return err(domainError('invalid_input', 'Application form: demographic questions are not supported yet.'))
  }
  const sections: Array<[FormQuestion['section'], z.infer<typeof GreenhouseQuestionSchema>[]]> = [
    ['main', form.questions],
    ['location', form.location_questions ?? []],
    ['compliance', (form.compliance ?? []).flatMap((c) => c.questions ?? [])],
  ]
  const questions: FormQuestion[] = []
  for (const [section, list] of sections) {
    for (const raw of list) {
      const question = readQuestion(raw, section)
      if (!question.ok) return question
      questions.push(question.value)
    }
  }
  return ok({ questions })
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
  async fetchApplicationForm(source, externalId, fetcher) {
    if (!/^\d+$/.test(externalId)) return err(domainError('invalid_input', `Not a Greenhouse job id: ${externalId}`))
    const fetched = await getJson(`https://boards-api.greenhouse.io/v1/boards/${source.config.token}/jobs/${externalId}?questions=true`, z.unknown(), fetcher)
    if (!fetched.ok) return fetched
    const form = readApplicationForm(fetched.value)
    return form.ok ? ok({ payload: fetched.value, form: form.value }) : form
  },
  readApplicationForm,
  async health(source, fetcher) {
    const checkedAt = new Date()
    const result = await getJson(`https://boards-api.greenhouse.io/v1/boards/${source.config.token}`, z.object({ name: z.string() }), fetcher)
    return result.ok ? { ok: true, checkedAt } : {
      ok: false, checkedAt, message: result.error.code === 'not_found' ? 'Board not found' : result.error.message,
    }
  },
}
