import { z } from 'zod'
import type { Result } from '@/lib/result'

/**
 * Every source implements this and nothing more. Adapters fetch verbatim
 * payloads and map each one to a NormalizedJob. Canonical `jobs` rows, dedupe,
 * eligibility, matching and ranking live downstream and stay source-agnostic.
 *
 * The enums below mirror `@/modules/jobs` on purpose: `jobs` will import this
 * module to normalize raw rows (M1.5), so importing `jobs` here would be a cycle.
 * The M1.5 mapping into NewJob is type-checked, so drift fails to compile.
 */

export const ADAPTER_KEYS = ['greenhouse', 'lever'] as const
export const AdapterKeySchema = z.enum(ADAPTER_KEYS)
export type AdapterKey = z.infer<typeof AdapterKeySchema>

const minorUnits = z.number().int().nonnegative()

/** An unstated salary is its own variant, never zero and never an estimate. */
export const NormalizedSalarySchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('unknown') }),
  z
    .object({
      source: z.literal('posted'),
      minMinor: minorUnits.nullable(),
      maxMinor: minorUnits.nullable(),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .refine((s) => s.minMinor !== null || s.maxMinor !== null, { message: 'a posted salary needs a bound' })
    .refine((s) => s.minMinor === null || s.maxMinor === null || s.minMinor <= s.maxMinor, {
      message: 'salary minimum exceeds maximum',
    }),
])
export type NormalizedSalary = z.infer<typeof NormalizedSalarySchema>

export const NormalizedJobSchema = z.object({
  externalId: z.string().min(1),
  /** The configured source name, not the payload's: boards label themselves inconsistently. */
  companyName: z.string().min(1),
  /** Verbatim from the posting. Decorations like "(Remote)" are stripped in M1.5, not here. */
  title: z.string().min(1),
  /**
   * Plain text derived deterministically from the posting (see html-text.ts).
   * The eligibility engine quotes from it, so the same payload must always
   * produce the same text.
   */
  description: z.string(),
  locationPolicy: z.enum(['onsite', 'hybrid', 'remote', 'unknown']),
  locationText: z.string().nullable(),
  /** ISO 3166-1 alpha-2 from a structured field only; null rather than parsed from free text. */
  locationCountry: z.string().regex(/^[A-Z]{2}$/).nullable(),
  employmentType: z.enum(['employee', 'contractor', 'eor', 'unknown']),
  salary: NormalizedSalarySchema,
  /** http(s) only: the jobs UI renders it as a link, and a javascript: URL would run. */
  applyUrl: z.url({ protocol: /^https?$/ }),
  postedAt: z.date().nullable(),
})
export type NormalizedJob = z.infer<typeof NormalizedJobSchema>

/**
 * A posting's application form, as the source publishes it (decision 0013). Only what is
 * needed to know what the form asks: no answers, nothing about any candidate.
 */
/** hidden: filled by the form itself (a location widget's coordinates), never by the candidate. */
export const FORM_FIELD_TYPES = ['text', 'textarea', 'file', 'single_select', 'multi_select', 'hidden'] as const
export const FormFieldSchema = z.object({
  /** The source's own field name ("first_name", "question_42848303"), what a filled form submits. */
  name: z.string().min(1),
  type: z.enum(FORM_FIELD_TYPES),
  options: z.array(z.object({ label: z.string(), value: z.string() })),
})
export type FormField = z.infer<typeof FormFieldSchema>

/** One question can offer several fields, any one of which answers it ("Resume": a file or pasted text). */
export const FormQuestionSchema = z.object({
  label: z.string().min(1),
  description: z.string().nullable(),
  required: z.boolean(),
  /** main: the posting's own questions; location, compliance (e.g. US EEO) and demographic: the board's standard sections. */
  section: z.enum(['main', 'location', 'compliance', 'demographic']),
  fields: z.array(FormFieldSchema).min(1),
})
export type FormQuestion = z.infer<typeof FormQuestionSchema>

export const ApplicationFormSchema = z.object({ questions: z.array(FormQuestionSchema) })
export type ApplicationForm = z.infer<typeof ApplicationFormSchema>

export type RawJob = {
  readonly externalId: string
  /** Exactly as the source returned it. Stored verbatim in raw_jobs and never mutated. */
  readonly payload: unknown
  readonly fetchedAt: Date
}

/** Opaque to everything but the adapter that produced it. */
export type Cursor = string

export type FetchResult = {
  readonly raw: readonly RawJob[]
  /** null when this was the last page. */
  readonly next: Cursor | null
}

export type SourceHealth = {
  readonly ok: boolean
  readonly checkedAt: Date
  readonly message?: string
}

/** Every adapter in M1.4 needs only a board token (Greenhouse) or site name (Lever). */
export const AdapterConfigSchema = z.object({ token: z.string().trim().regex(/^[A-Za-z0-9_-]{1,100}$/) })
export type AdapterConfig = z.infer<typeof AdapterConfigSchema>

/** What an adapter knows about the source it is reading. */
export type SourceRef = {
  readonly name: string
  readonly config: AdapterConfig
}

/** Network access is injected so tests run against committed fixtures, never the live API. */
export type Fetcher = typeof fetch

export type JobSourceAdapter = {
  readonly key: AdapterKey
  readonly kind: 'ats' | 'board' | 'aggregator'
  /**
   * Top-level payload fields that change without the posting changing (Greenhouse bumps
   * `updated_at` daily). Left out of the content hash so they do not create new raw
   * versions; the stored payload still contains them.
   */
  readonly volatileKeys: readonly string[]
  /**
   * One page. Network failures and non-2xx responses are `upstream_failed`; a
   * response whose envelope does not match the expected shape is `validation_failed`.
   */
  fetchPage(source: SourceRef, cursor: Cursor | null, fetcher: Fetcher): Promise<Result<FetchResult>>
  /**
   * Pure and deterministic: no I/O, no clock. A payload missing a required
   * field is `invalid_input`. Never throws.
   */
  normalize(raw: RawJob, source: SourceRef): Result<NormalizedJob>
  /** Used when a source is registered and shown on the admin page. Never throws. */
  health(source: SourceRef, fetcher: Fetcher): Promise<SourceHealth>
  /**
   * The posting's application form, for sources that publish one in structured form
   * (decision 0013). Absent for sources that do not. Returns the verbatim payload with
   * the form read from it, so the form can be re-read from what was stored. Never throws.
   */
  fetchApplicationForm?(source: SourceRef, externalId: string, fetcher: Fetcher): Promise<Result<{ readonly payload: unknown; readonly form: ApplicationForm }>>
  /** Pure: the form read from a stored payload. Present whenever fetchApplicationForm is. */
  readApplicationForm?(payload: unknown): Result<ApplicationForm>
}
