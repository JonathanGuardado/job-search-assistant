import { describe, expect, it } from 'vitest'
import { EnvSchema } from './env.js'

const config = {
  DATABASE_URL: 'postgres://localhost/test',
  DATABASE_ADMIN_URL: 'postgres://localhost/test',
  REDIS_URL: 'redis://localhost',
}

describe('AI environment configuration', () => {
  it('can boot without provider credentials', () => {
    expect(EnvSchema.parse(config)).toMatchObject({ AI_MODEL_PRICING: {} })
    const parsed = EnvSchema.parse({ ...config, AI_PRIMARY_PROVIDER: '', AI_PRIMARY_API_KEY: '', AI_SECONDARY_PROVIDER: 'deepseek', AI_SECONDARY_API_KEY: 'key' })
    expect(parsed).toMatchObject({ AI_PRIMARY_PROVIDER: undefined, AI_PRIMARY_API_KEY: undefined, AI_SECONDARY_PROVIDER: 'deepseek', AI_SECONDARY_API_KEY: 'key' })
  })

  it('rejects an unsupported provider', () => {
    expect(EnvSchema.safeParse({ ...config, AI_PRIMARY_PROVIDER: 'anthropic' }).success).toBe(false)
  })

  it('parses new model rates and rejects malformed pricing', () => {
    const parsed = EnvSchema.parse({ ...config, AI_MODEL_PRICING: '{"gemini/new-model":{"input":1,"output":2,"cacheRead":0.1}}' })
    expect(parsed.AI_MODEL_PRICING['gemini/new-model']).toEqual({ input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 })
    for (const invalid of ['not json', '{"model":{"input":-1,"output":2,"cacheRead":0}}']) {
      expect(EnvSchema.safeParse({ ...config, AI_MODEL_PRICING: invalid }).success).toBe(false)
    }
  })
})
