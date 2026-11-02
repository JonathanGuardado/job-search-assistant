import { z } from 'zod'
import { domainError, err, ok } from '@/lib/result'
import { postJson } from './http.js'
import type { Provider, ProviderStop } from './provider.js'

const tokens = z.number().int().nonnegative()
const ResponseSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string(),
    message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }),
  })).min(1),
  usage: z.object({
    prompt_tokens: tokens,
    completion_tokens: tokens,
    prompt_tokens_details: z.object({ cached_tokens: tokens.default(0) }).optional(),
  }).refine((usage) => (usage.prompt_tokens_details?.cached_tokens ?? 0) <= usage.prompt_tokens),
})

function toStop(reason: string): ProviderStop {
  if (reason === 'stop') return 'complete'
  if (reason === 'length') return 'truncated'
  if (reason === 'content_filter') return 'refused'
  return 'other'
}

export function openaiProvider(apiKey: string, fetcher: typeof fetch = fetch): Provider {
  return {
    name: 'openai',
    async complete(request) {
      // Not strict: strict mode rejects optional fields, which task schemas use. callModel validates.
      const { $schema: _, ...schema } = z.toJSONSchema(request.outputSchema)
      const result = await postJson({
        provider: 'openai',
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: {
          model: request.model,
          max_completion_tokens: request.maxTokens,
          // Extraction uses a bounded output budget; hidden reasoning must not consume it.
          reasoning_effort: 'none',
          // Chat Completions keeps no application state by default; say so rather than rely on it.
          store: false,
          response_format: { type: 'json_schema', json_schema: { name: 'output', schema, strict: false } },
          messages: [{ role: 'system', content: request.system }, ...request.messages],
        },
        schema: ResponseSchema,
      }, fetcher)
      if (!result.ok) return result
      const { choices, usage } = result.value
      const choice = choices[0]
      if (!choice) return err(domainError('upstream_failed', 'openai: missing choice'))
      const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
      const refused = typeof choice.message.refusal === 'string' && choice.message.refusal.length > 0
      return ok({
        text: choice.message.content ?? '',
        stop: refused ? 'refused' : toStop(choice.finish_reason),
        rawStopReason: refused ? 'refusal' : choice.finish_reason,
        usage: {
          inputTokens: usage.prompt_tokens - cached,
          // Reasoning tokens are part of completion_tokens and billed as output.
          outputTokens: usage.completion_tokens,
          cacheReadTokens: cached,
          cacheWriteTokens: 0,
        },
      })
    },
  }
}
