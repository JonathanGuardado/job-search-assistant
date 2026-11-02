import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { deepseekProvider } from './deepseek.js'
import { geminiProvider } from './gemini.js'
import { openaiProvider } from './openai.js'
import { configuredModel, configuredModelName } from './configured-provider.js'
import type { ProviderRequest } from './provider.js'

const request: ProviderRequest = {
  model: 'deepseek-flash',
  system: 'Extract a country.',
  messages: [{ role: 'user', content: 'Mexico only' }],
  maxTokens: 256,
  outputSchema: z.object({ country: z.string().length(2) }),
}

function deepseekResponse(reason = 'stop') {
  return {
    choices: [{ finish_reason: reason, message: { content: '{"country":"MX"}' } }],
    usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 40, completion_tokens: 20 },
  }
}

function geminiResponse(reason = 'STOP') {
  return {
    candidates: [{
      finishReason: reason,
      content: { parts: [{ text: 'internal thought', thought: true }, { text: '{"country":"MX"}' }] },
    }],
    usageMetadata: {
      promptTokenCount: 100,
      cachedContentTokenCount: 40,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 10,
    },
  }
}

function openaiResponse(reason = 'stop', refusal: string | null = null) {
  return {
    choices: [{ finish_reason: reason, message: { content: refusal === null ? '{"country":"MX"}' : null, refusal } }],
    usage: { prompt_tokens: 100, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 40 } },
  }
}

afterEach(() => vi.useRealTimers())

describe('DeepSeek adapter', () => {
  it('sends JSON instructions and normalizes cached usage without double counting', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(deepseekResponse()))
    const result = await deepseekProvider('test-key', fetcher).complete(request)
    const [url, options] = fetcher.mock.calls[0]!
    const body: unknown = JSON.parse(z.string().parse(options?.body))

    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    expect(body).toMatchObject({ model: 'deepseek-flash', max_tokens: 256, response_format: { type: 'json_object' } })
    expect(body).toMatchObject({ messages: [
      { role: 'system', content: expect.stringContaining('Return JSON only') },
      { role: 'user', content: 'Mexico only' },
    ] })
    expect(JSON.stringify(body)).toContain('country')
    expect(result).toMatchObject({ ok: true, value: {
      text: '{"country":"MX"}', stop: 'complete', rawStopReason: 'stop',
      usage: { inputTokens: 60, cacheReadTokens: 40, outputTokens: 20, cacheWriteTokens: 0 },
    } })
  })

  it.each([['length', 'truncated'], ['content_filter', 'refused'], ['aborted', 'other']])(
    'maps %s to %s', async (reason, stop) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(deepseekResponse(reason)))
      const result = await deepseekProvider('test-key', fetcher).complete(request)
      expect(result.ok && result.value.stop).toBe(stop)
    },
  )

  it('rejects a malformed API envelope', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [], usage: {} }))
    const result = await deepseekProvider('test-key', fetcher).complete(request)
    expect(result).toMatchObject({ ok: false, error: { code: 'upstream_failed' } })
  })
})

describe('Gemini adapter', () => {
  it('sends the schema and retry history, excludes thought text, and counts thinking tokens', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(geminiResponse()))
    const result = await geminiProvider('test-key', fetcher).complete({
      ...request,
      model: 'gemini-3.5-flash-lite',
      messages: [...request.messages, { role: 'assistant', content: '{}' }, { role: 'user', content: 'Try again' }],
    })
    const [url, options] = fetcher.mock.calls[0]!
    const body: unknown = JSON.parse(z.string().parse(options?.body))

    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
    expect(options?.headers).toMatchObject({ 'x-goog-api-key': 'test-key' })
    expect(body).toMatchObject({
      systemInstruction: { parts: [{ text: 'Extract a country.' }] },
      contents: [{ role: 'user' }, { role: 'model' }, { role: 'user' }],
      generationConfig: { maxOutputTokens: 256, responseFormat: {
        text: { mimeType: 'APPLICATION_JSON', schema: { properties: { country: { type: 'string' } } } },
      } },
    })
    expect(result).toMatchObject({ ok: true, value: {
      text: '{"country":"MX"}', stop: 'complete',
      usage: { inputTokens: 60, cacheReadTokens: 40, outputTokens: 30, cacheWriteTokens: 0 },
    } })
  })

  it.each([['MAX_TOKENS', 'truncated'], ['SAFETY', 'refused'], ['OTHER', 'other']])(
    'maps %s to %s', async (reason, stop) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(geminiResponse(reason)))
      const result = await geminiProvider('test-key', fetcher).complete(request)
      expect(result.ok && result.value.stop).toBe(stop)
    },
  )

  it('recognizes a blocked prompt even without candidates', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ promptFeedback: { blockReason: 'SAFETY' } }))
    const result = await geminiProvider('test-key', fetcher).complete(request)
    expect(result).toMatchObject({ ok: true, value: { stop: 'refused', rawStopReason: 'SAFETY' } })
  })

  it.each([{}, { candidates: [{ finishReason: 'STOP' }] }, { candidates: 'invalid' }])(
    'rejects a malformed or incomplete API envelope: %j', async (payload) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload))
      const result = await geminiProvider('test-key', fetcher).complete(request)
      expect(result).toMatchObject({ ok: false, error: { code: 'upstream_failed' } })
    },
  )
})

describe('OpenAI adapter', () => {
  it('sends the schema without reasoning or storage, and normalizes cached usage', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(openaiResponse()))
    const result = await openaiProvider('test-key', fetcher).complete({ ...request, model: 'gpt-6-luna' })
    const [url, options] = fetcher.mock.calls[0]!
    const body: unknown = JSON.parse(z.string().parse(options?.body))

    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    expect(body).toMatchObject({
      model: 'gpt-6-luna', max_completion_tokens: 256, reasoning_effort: 'none', store: false,
      response_format: { type: 'json_schema', json_schema: { strict: false, schema: { properties: { country: { type: 'string' } } } } },
      messages: [{ role: 'system', content: 'Extract a country.' }, { role: 'user', content: 'Mexico only' }],
    })
    expect(JSON.stringify(body)).not.toContain('$schema')
    expect(result).toMatchObject({ ok: true, value: {
      text: '{"country":"MX"}', stop: 'complete', rawStopReason: 'stop',
      usage: { inputTokens: 60, cacheReadTokens: 40, outputTokens: 30, cacheWriteTokens: 0 },
    } })
  })

  it.each([['length', 'truncated'], ['content_filter', 'refused'], ['tool_calls', 'other']])(
    'maps %s to %s', async (reason, stop) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(openaiResponse(reason)))
      const result = await openaiProvider('test-key', fetcher).complete(request)
      expect(result.ok && result.value.stop).toBe(stop)
    },
  )

  it('reports a refusal message as refused', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(openaiResponse('stop', 'I cannot help with that.')))
    const result = await openaiProvider('test-key', fetcher).complete(request)
    expect(result).toMatchObject({ ok: true, value: { stop: 'refused', rawStopReason: 'refusal', text: '' } })
  })

  it('rejects a malformed API envelope', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [], usage: {} }))
    const result = await openaiProvider('test-key', fetcher).complete(request)
    expect(result).toMatchObject({ ok: false, error: { code: 'upstream_failed' } })
  })
})

describe('provider HTTP failures', () => {
  it('retries a transient HTTP failure then succeeds', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(Response.json(deepseekResponse()))
    const pending = deepseekProvider('test-key', fetcher).complete(request)
    await vi.runAllTimersAsync()
    expect((await pending).ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('reports a quota that stays exhausted as rate_limited, so the queue can pause', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('quota', { status: 429 }))
    const pending = geminiProvider('test-key', fetcher).complete(request)
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ ok: false, error: { code: 'rate_limited' } })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('bounds network retries and does not expose request credentials', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-test-key'))
    const pending = deepseekProvider('secret-test-key', fetcher).complete(request)
    await vi.runAllTimersAsync()
    const result = await pending
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ ok: false, error: { code: 'upstream_failed' } })
    expect(JSON.stringify(result)).not.toContain('secret-test-key')
  })

  it('does not retry an invalid API key or echo the error body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-test-key', { status: 401 }))
    const result = await geminiProvider('secret-test-key', fetcher).complete(request)
    expect(result).toMatchObject({ ok: false, error: { message: 'gemini: HTTP 401' } })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('says plainly when the account is out of credit, without retrying', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 402 }))
    const result = await geminiProvider('test-key', fetcher).complete(request)
    expect(result).toMatchObject({ ok: false, error: { code: 'upstream_failed', message: expect.stringContaining('gemini: out of credit (HTTP 402)') } })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reads OpenAI\'s insufficient_quota 429 as out of credit, not a rate limit, without retrying or echoing the body', async () => {
    const body = JSON.stringify({ error: { message: 'You exceeded your current quota, secret-test-key', code: 'insufficient_quota' } })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 429 }))
    const result = await openaiProvider('secret-test-key', fetcher).complete(request)
    expect(result).toMatchObject({ ok: false, error: { code: 'upstream_failed', message: expect.stringContaining('openai: out of credit (HTTP 429)') } })
    expect(JSON.stringify(result)).not.toContain('secret-test-key')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('returns a typed failure for a non-JSON response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>proxy failure</html>'))
    const result = await deepseekProvider('test-key', fetcher).complete(request)
    expect(result).toMatchObject({ ok: false, error: { message: 'deepseek: invalid JSON response' } })
  })
})

describe('provider selection', () => {
  const unset = {
    AI_PRIMARY_PROVIDER: undefined, AI_PRIMARY_MODEL: undefined, AI_PRIMARY_API_KEY: undefined,
    AI_SECONDARY_PROVIDER: undefined, AI_SECONDARY_MODEL: undefined, AI_SECONDARY_API_KEY: undefined,
  }

  it('takes each role\'s provider, model and key from the configuration, either provider in either role', () => {
    const config = {
      ...unset,
      AI_PRIMARY_PROVIDER: 'deepseek' as const, AI_PRIMARY_MODEL: 'deepseek-flash', AI_PRIMARY_API_KEY: 'k1',
      AI_SECONDARY_PROVIDER: 'gemini' as const, AI_SECONDARY_MODEL: 'gemini-3.5-flash-lite', AI_SECONDARY_API_KEY: 'k2',
    }
    expect(configuredModel(config, 'primary')).toMatchObject({ provider: { name: 'deepseek' }, id: 'deepseek-flash' })
    expect(configuredModel(config, 'secondary')).toMatchObject({ provider: { name: 'gemini' }, id: 'gemini-3.5-flash-lite' })
    expect(configuredModelName(config, 'secondary')).toBe('gemini/gemini-3.5-flash-lite')
    const luna = { ...config, AI_PRIMARY_PROVIDER: 'openai' as const, AI_PRIMARY_MODEL: 'gpt-6-luna' }
    expect(configuredModel(luna, 'primary')).toMatchObject({ provider: { name: 'openai' }, id: 'gpt-6-luna' })
  })

  it('needs only the settings of the role asked for, and names what is missing', () => {
    const onlyPrimary = { ...unset, AI_PRIMARY_PROVIDER: 'gemini' as const, AI_PRIMARY_MODEL: 'gemini-3.5-flash-lite', AI_PRIMARY_API_KEY: 'k' }
    expect(configuredModel(onlyPrimary, 'primary').provider.name).toBe('gemini')
    expect(() => configuredModel(onlyPrimary, 'secondary'))
      .toThrow('AI_SECONDARY_PROVIDER, AI_SECONDARY_MODEL, AI_SECONDARY_API_KEY not set for the secondary model')
    expect(() => configuredModel({ ...onlyPrimary, AI_PRIMARY_API_KEY: undefined }, 'primary')).toThrow('AI_PRIMARY_API_KEY not set')
    expect(configuredModelName(onlyPrimary, 'secondary')).toBeNull()
  })
})
