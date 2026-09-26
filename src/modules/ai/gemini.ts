import { z } from 'zod'
import { domainError, err, ok } from '@/lib/result'
import { postJson } from './http.js'
import type { Provider, ProviderResponse, ProviderStop } from './provider.js'

const tokens = z.number().int().nonnegative()
const ResponseSchema = z.object({
  candidates: z.array(z.object({
    finishReason: z.string(),
    content: z.object({
      parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })),
    }).optional(),
  })).optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z.object({
    promptTokenCount: tokens.default(0),
    candidatesTokenCount: tokens.default(0),
    thoughtsTokenCount: tokens.default(0),
    cachedContentTokenCount: tokens.default(0),
  }).refine((usage) => usage.cachedContentTokenCount <= usage.promptTokenCount).optional(),
})

function toStop(reason: string): ProviderStop {
  if (reason === 'STOP') return 'complete'
  if (reason === 'MAX_TOKENS') return 'truncated'
  if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].includes(reason)) {
    return 'refused'
  }
  return 'other'
}

function toResponse(response: z.infer<typeof ResponseSchema>) {
  const candidate = response.candidates?.[0]
  const blocked = response.promptFeedback?.blockReason
  if (!candidate && (!blocked || blocked === 'BLOCK_REASON_UNSPECIFIED')) {
    return err(domainError('upstream_failed', 'gemini: missing candidate'))
  }
  if (candidate && !response.usageMetadata) {
    return err(domainError('upstream_failed', 'gemini: missing usage metadata'))
  }
  const rawStopReason = candidate?.finishReason ?? blocked ?? 'UNKNOWN'
  const usage = response.usageMetadata
  return ok<ProviderResponse>({
    text: candidate?.content?.parts.filter((part) => !part.thought).map((part) => part.text ?? '').join('') ?? '',
    stop: candidate ? toStop(rawStopReason) : 'refused',
    rawStopReason,
    usage: {
      inputTokens: (usage?.promptTokenCount ?? 0) - (usage?.cachedContentTokenCount ?? 0),
      outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      cacheReadTokens: usage?.cachedContentTokenCount ?? 0,
      cacheWriteTokens: 0,
    },
  })
}

export function geminiProvider(apiKey: string, fetcher: typeof fetch = fetch): Provider {
  return {
    name: 'gemini',
    async complete(request) {
      const result = await postJson({
        provider: 'gemini',
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`,
        headers: { 'x-goog-api-key': apiKey },
        body: {
          systemInstruction: { parts: [{ text: request.system }] },
          contents: request.messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          generationConfig: {
            maxOutputTokens: request.maxTokens,
            responseFormat: {
              text: { mimeType: 'application/json', schema: z.toJSONSchema(request.outputSchema) },
            },
          },
        },
        schema: ResponseSchema,
      }, fetcher)
      return result.ok ? toResponse(result.value) : result
    },
  }
}
