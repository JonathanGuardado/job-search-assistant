import { z } from 'zod'
import { domainError, err, ok } from '@/lib/result'
import { postJson } from './http.js'
import type { Provider, ProviderStop } from './provider.js'

const tokens = z.number().int().nonnegative()
const ResponseSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string(),
    message: z.object({ content: z.string().nullable() }),
  })).min(1),
  usage: z.object({
    prompt_tokens: tokens,
    completion_tokens: tokens,
    prompt_cache_hit_tokens: tokens.default(0),
  }).refine((usage) => usage.prompt_cache_hit_tokens <= usage.prompt_tokens),
})

function toStop(reason: string): ProviderStop {
  if (reason === 'stop') return 'complete'
  if (reason === 'length') return 'truncated'
  if (reason === 'content_filter') return 'refused'
  return 'other'
}

export function deepseekProvider(apiKey: string, fetcher: typeof fetch = fetch): Provider {
  return {
    name: 'deepseek',
    async complete(request) {
      const schema = z.toJSONSchema(request.outputSchema)
      const result = await postJson({
        provider: 'deepseek',
        url: 'https://api.deepseek.com/chat/completions',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: {
          model: request.model,
          max_tokens: request.maxTokens,
          // Extraction uses a bounded output budget; hidden thinking must not consume it.
          thinking: { type: 'disabled' },
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${request.system}\nReturn JSON only matching this JSON schema:\n${JSON.stringify(schema)}` },
            ...request.messages,
          ],
        },
        schema: ResponseSchema,
      }, fetcher)
      if (!result.ok) return result
      const { choices, usage } = result.value
      const choice = choices[0]
      if (!choice) return err(domainError('upstream_failed', 'deepseek: missing candidate'))
      return ok({
        text: choice.message.content ?? '',
        stop: toStop(choice.finish_reason),
        rawStopReason: choice.finish_reason,
        usage: {
          inputTokens: usage.prompt_tokens - usage.prompt_cache_hit_tokens,
          outputTokens: usage.completion_tokens,
          cacheReadTokens: usage.prompt_cache_hit_tokens,
          cacheWriteTokens: 0,
        },
      })
    },
  }
}
