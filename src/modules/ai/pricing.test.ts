import { describe, expect, it } from 'vitest'
import { costMicroUsd, priceOf } from './pricing.js'

describe('model pricing', () => {
  it('uses explicit cache prices instead of assuming one vendor multiplier', () => {
    expect(costMicroUsd(
      { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
      { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 1_000, cacheWriteTokens: 0 },
    )).toBe(426)
  })

  it('supports future models and overrides without changing code', () => {
    const configured = { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 0 }
    expect(priceOf('gemini', 'future-model', { 'gemini/future-model': configured })).toEqual(configured)
    expect(priceOf('deepseek', 'deepseek-flash', { 'deepseek/deepseek-flash': configured })).toEqual(configured)
    expect(priceOf('deepseek', 'future-model', { 'gemini/future-model': configured })).toBeUndefined()
  })
})
