import { z } from 'zod'
import { AdapterConfigSchema, AdapterKeySchema, type AdapterConfig, type AdapterKey, type NormalizedJob } from './adapter.js'

export const SOURCE_HEALTH_STATUSES = ['unknown', 'ok', 'failing'] as const
export const SourceHealthStatusSchema = z.enum(SOURCE_HEALTH_STATUSES)
export type SourceHealthStatus = z.infer<typeof SourceHealthStatusSchema>

export const SourcePollPayloadSchema = z.object({
  sourceId: z.uuid(),
  pollId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).nullable(),
  /** When the poll's first page was enqueued. Jobs not seen since then are closed after the last page. */
  startedAt: z.coerce.date(),
})
export type SourcePollPayload = z.infer<typeof SourcePollPayloadSchema>

/** One posting on a fetched page and the raw version that now represents it. */
export type PagePosting = { readonly externalId: string; readonly rawJobId: string }

export type PollOutcome =
  | { readonly kind: 'disabled' }
  | {
      readonly kind: 'page'
      readonly sourceId: string
      readonly fetchedAt: Date
      /** Every posting on the page, unchanged ones included, so a retry recomputes the same work. */
      readonly postings: readonly PagePosting[]
      readonly isFinalPage: boolean
    }

/** A stored raw version, normalized by its source's adapter, with what jobs needs to place it. */
export type NormalizedPosting = {
  readonly rawJobId: string
  readonly sourceId: string
  readonly externalId: string
  readonly fetchedAt: Date
  /** When any version of this posting was first captured. */
  readonly firstFetchedAt: Date
  readonly job: NormalizedJob
}

export const NewSourceSchema = z.object({
  adapterKey: AdapterKeySchema,
  name: z.string().trim().min(1).max(100),
  token: AdapterConfigSchema.shape.token,
})
export type NewSource = z.infer<typeof NewSourceSchema>

export type JobSource = {
  id: string
  adapterKey: AdapterKey
  name: string
  /** null when the stored jsonb no longer parses; polling marks such a source failing. */
  config: AdapterConfig | null
  enabled: boolean
  cursor: string | null
  lastPolledAt: Date | null
  healthStatus: SourceHealthStatus
  healthMessage: string | null
  healthCheckedAt: Date | null
  createdAt: Date
}
export type JobSourceSummary = JobSource & { readonly rawJobCount: number }
export type NormalizationReport = {
  readonly checked: number
  readonly failures: readonly { sourceId: string; externalId: string; message: string }[]
}
