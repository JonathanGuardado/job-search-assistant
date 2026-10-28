import type { z } from 'zod'
import type { Result } from '@/lib/result'
import type { ProviderName } from './types.js'

/**
 * The seam between callModel and a vendor API. Implementations: `deepseek.ts`, `gemini.ts`
 * and the scripted fake in `service.test.ts`.
 */

export type ProviderMessage = { readonly role: 'user' | 'assistant'; readonly content: string }

export type ProviderRequest = {
  readonly model: string
  readonly system: string
  readonly messages: readonly ProviderMessage[]
  readonly maxTokens: number
  /** Sent as a JSON schema or prompt instruction. callModel always validates the output. */
  readonly outputSchema: z.ZodType
}

export type ProviderStop = 'complete' | 'refused' | 'truncated' | 'other'

export type ProviderResponse = {
  readonly text: string
  readonly stop: ProviderStop
  /** The vendor's own stop reason, kept verbatim for the trace. */
  readonly rawStopReason: string
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cacheReadTokens: number
    readonly cacheWriteTokens: number
  }
}

export type Provider = {
  readonly name: ProviderName
  complete(request: ProviderRequest): Promise<Result<ProviderResponse>>
}
