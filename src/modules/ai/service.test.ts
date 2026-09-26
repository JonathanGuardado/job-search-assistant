import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { domainError, err, ok, type Result } from '@/lib/result'
import type { Provider, ProviderRequest, ProviderResponse, ProviderStop } from './provider.js'
import { createModelCaller } from './service.js'
import type { ModelTrace, TaskDefinition } from './types.js'

const CountrySchema = z.object({ country: z.string().length(2) })

const task: TaskDefinition<{ text: string }> = {
  name: 'test.country',
  version: 3,
  tier: 'extraction',
  system: 'Extract the country.',
  render: ({ text }) => `Posting: ${text}`,
  maxTokens: 256,
}

function reply(text: string, stop: ProviderStop = 'complete'): Result<ProviderResponse> {
  return ok({
    text,
    stop,
    rawStopReason: stop,
    usage: { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
  })
}

/** Plays back scripted responses and records every request it receives. */
function scriptedProvider(...script: Result<ProviderResponse>[]) {
  const requests: ProviderRequest[] = []
  const provider: Provider = {
    name: 'deepseek',
    async complete(request) {
      requests.push(request)
      const next = script.shift()
      if (!next) throw new Error('provider called more times than scripted')
      return next
    },
  }
  return { provider, requests }
}

function caller(provider: Provider, traces: ModelTrace[] = []) {
  return createModelCaller({
    provider,
    models: { extraction: 'deepseek-flash', reasoning: 'deepseek-v4-pro' },
    onTrace: (trace) => traces.push(trace),
  })
}

describe('callModel', () => {
  it('returns the validated value and a costed trace', async () => {
    const { provider, requests } = scriptedProvider(reply('{"country":"MX"}'))
    const result = await caller(provider)({ task, schema: CountrySchema, input: { text: 'Mexico only' } })

    expect(result.ok && result.value.value).toEqual({ country: 'MX' })
    expect(requests[0]).toMatchObject({
      model: 'deepseek-flash',
      system: 'Extract the country.',
      maxTokens: 256,
      messages: [{ role: 'user', content: 'Posting: Mexico only' }],
    })
    // Peak-rate estimate: 1,000 in x $0.30/MTok + 100 out x $1.20/MTok.
    expect(result.ok && result.value.traces).toEqual([
      expect.objectContaining({
        task: 'test.country',
        taskVersion: 3,
        provider: 'deepseek',
        model: 'deepseek-flash',
        attempt: 1,
        costMicroUsd: 420,
        rawOutput: '{"country":"MX"}',
        validationError: null,
      }),
    ])
  })

  it('retries once with the validation error appended, then succeeds', async () => {
    const { provider, requests } = scriptedProvider(
      reply('{"country":"Mexico"}'),
      reply('{"country":"MX"}'),
    )
    const traces: ModelTrace[] = []
    const result = await caller(provider, traces)({ task, schema: CountrySchema, input: { text: 'x' } })

    expect(result.ok && result.value.value).toEqual({ country: 'MX' })
    expect(traces.map((t) => t.attempt)).toEqual([1, 2])
    expect(traces[0]?.validationError).toMatch(/country/)

    const retry = requests[1]?.messages ?? []
    expect(retry).toHaveLength(3)
    expect(retry[1]).toEqual({ role: 'assistant', content: '{"country":"Mexico"}' })
    expect(retry[2]?.content).toContain(traces[0]?.validationError ?? '<missing>')
  })

  it('fails the record after the second invalid output, never guessing a value', async () => {
    const { provider } = scriptedProvider(reply('not json'), reply('{"country":"Mexico"}'))
    const result = await caller(provider)({ task, schema: CountrySchema, input: { text: 'x' } })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('validation_failed')
    expect(!result.ok && result.error.traces).toHaveLength(2)
  })

  it('does not retry a refusal', async () => {
    const { provider, requests } = scriptedProvider(reply('', 'refused'))
    const result = await caller(provider)({ task, schema: CountrySchema, input: { text: 'x' } })

    expect(!result.ok && result.error.code).toBe('refused')
    expect(requests).toHaveLength(1)
  })

  it('does not retry a truncated output', async () => {
    const { provider, requests } = scriptedProvider(reply('{"coun', 'truncated'))
    const result = await caller(provider)({ task, schema: CountrySchema, input: { text: 'x' } })

    expect(!result.ok && result.error.code).toBe('truncated')
    expect(requests).toHaveLength(1)
  })

  it('surfaces a provider failure as upstream_failed', async () => {
    const { provider } = scriptedProvider(err(domainError('upstream_failed', 'deepseek: HTTP 503')))
    const result = await caller(provider)({ task, schema: CountrySchema, input: { text: 'x' } })

    expect(!result.ok && result.error).toMatchObject({ code: 'upstream_failed', traces: [] })
  })

  it('refuses to call a model it cannot price', async () => {
    const { provider, requests } = scriptedProvider()
    const call = createModelCaller({
      provider,
      models: { extraction: 'some-unpriced-model', reasoning: 'deepseek-v4-pro' },
    })
    await expect(call({ task, schema: CountrySchema, input: { text: 'x' } })).rejects.toThrow(
      /no price for model some-unpriced-model/,
    )
    expect(requests).toHaveLength(0)
  })

  it('runs a future model using configured rates and records its provider', async () => {
    const { provider, requests } = scriptedProvider(reply('{"country":"MX"}'))
    const call = createModelCaller({
      provider: { ...provider, name: 'gemini' },
      models: { extraction: 'future-model', reasoning: 'another-model' },
      prices: { 'gemini/future-model': { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 0 } },
      onTrace: () => undefined,
    })
    const result = await call({ task, schema: CountrySchema, input: { text: 'Mexico only' } })
    expect(requests[0]?.model).toBe('future-model')
    expect(result.ok && result.value.traces[0]).toMatchObject({
      provider: 'gemini', model: 'future-model', costMicroUsd: 2_800,
    })
  })
})
