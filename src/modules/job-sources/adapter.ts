import { z } from 'zod'

/**
 * Every source implements this and nothing more. Adapters fetch verbatim
 * payloads and map them to the canonical model. Eligibility, matching and
 * ranking live downstream and stay source-agnostic.
 */

export const NormalizedJobSchema = z.object({
  externalId: z.string().min(1),
  companyName: z.string().min(1),
  title: z.string().min(1),
  /** Full text, verbatim. The eligibility engine reads this. */
  description: z.string(),
  locationPolicy: z.enum(['onsite', 'hybrid', 'remote', 'unknown']),
  locationText: z.string().nullable(),
  /** ISO 3166-1 alpha-2, or null when it cannot be determined confidently. */
  locationCountry: z.string().length(2).nullable(),
  employmentType: z.enum(['employee', 'contractor', 'eor', 'unknown']),
  salaryMinMinor: z.number().int().nullable(),
  salaryMaxMinor: z.number().int().nullable(),
  salaryCurrency: z.string().length(3).nullable(),
  /**
   * 'unknown' means the posting did not state a salary. It is NOT the same as
   * zero, and it must never be replaced with an estimate.
   */
  salarySource: z.enum(['posted', 'unknown']),
  applyUrl: z.string().url(),
  postedAt: z.date().nullable(),
})

export type NormalizedJob = z.infer<typeof NormalizedJobSchema>

export type RawJob = {
  readonly externalId: string
  readonly payload: unknown
  readonly fetchedAt: Date
}

export type Cursor = string

export type FetchResult = {
  readonly raw: readonly RawJob[]
  readonly next: Cursor | null
}

export type SourceHealth = {
  readonly ok: boolean
  readonly checkedAt: Date
  readonly message?: string
}

export type AdapterConfig = Record<string, string>

export type JobSourceAdapter = {
  readonly key: string
  readonly kind: 'ats' | 'board' | 'aggregator'
  /** Validates the per-source config (e.g. a board token) at registration time. */
  readonly configSchema: z.ZodType<AdapterConfig>
  fetchPage(config: AdapterConfig, cursor: Cursor | null): Promise<FetchResult>
  normalize(raw: RawJob): NormalizedJob
  health(config: AdapterConfig): Promise<SourceHealth>
}
