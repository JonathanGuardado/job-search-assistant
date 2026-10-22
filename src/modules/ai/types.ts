import { z } from 'zod'

export const MODEL_TIERS = ['extraction', 'reasoning'] as const
export type ModelTier = (typeof MODEL_TIERS)[number]

/**
 * A named, versioned model task. Defined in the calling module's
 * `prompts/<task>.ts` (docs/conventions.md), never inline in business logic.
 * Bump `version` on any prompt change so stored traces stay comparable.
 */
export type TaskDefinition<I> = {
  /** `<module>.<task>`, e.g. `eligibility.extract`. */
  readonly name: string
  readonly version: number
  readonly tier: ModelTier
  readonly system: string
  readonly render: (input: I) => string
  readonly maxTokens: number
}

/** One provider attempt. Callers store these against the record the call produced. */
export const ModelTraceSchema = z.object({
  task: z.string(),
  taskVersion: z.number().int(),
  provider: z.string(),
  model: z.string(),
  attempt: z.number().int().positive(),
  stopReason: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  /** Estimated token cost at the configured rates; not a provider billing receipt. */
  costMicroUsd: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  rawOutput: z.string(),
  /** Why this attempt's output was rejected, or null when it was accepted or never parsed. */
  validationError: z.string().nullable(),
})
export type ModelTrace = z.infer<typeof ModelTraceSchema>

export type AiErrorCode =
  | 'validation_failed' // output failed the schema twice
  | 'upstream_failed' // provider or network error
  | 'rate_limited' // provider quota exhausted; the same request succeeds later
  | 'refused' // the model declined; retrying the same request will not help
  | 'truncated' // hit max_tokens; the task's budget is wrong, not the output

/** Failed calls still cost money, so the traces travel with the error. */
export type AiError = {
  readonly code: AiErrorCode
  readonly message: string
  readonly traces: readonly ModelTrace[]
}
