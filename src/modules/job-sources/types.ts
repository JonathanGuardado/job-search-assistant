import { z } from 'zod'
import { AdapterConfigSchema, AdapterKeySchema, type AdapterKey, type AdapterConfig } from './adapter.js'

export const SOURCE_HEALTH_STATUSES = ['unknown', 'ok', 'failing'] as const
export const SourceHealthStatusSchema = z.enum(SOURCE_HEALTH_STATUSES)
export type SourceHealthStatus = z.infer<typeof SourceHealthStatusSchema>

export const SourcePollPayloadSchema = z.object({
  sourceId: z.uuid(),
  pollId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).nullable(),
})
export type SourcePollPayload = z.infer<typeof SourcePollPayloadSchema>

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
