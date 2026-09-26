import type { z } from 'zod'
import type { ModelPriceSchema } from '@/lib/env'

export type Price = z.infer<typeof ModelPriceSchema>

/**
 * USD per million tokens equals micro-USD per token. These are estimates:
 * DeepSeek uses peak rates; Gemini uses standard paid text rates. Overrides
 * support new models and account-specific rates without a code change.
 * Sources and limitations: docs/ai-providers.md (checked 2026-09-25).
 */
const PRICES: Readonly<Record<string, Price>> = {
  'deepseek/deepseek-flash': { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
  'deepseek/deepseek-v4-pro': { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 },
  'gemini/gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
}

export function priceOf(
  provider: string,
  model: string,
  overrides: Readonly<Record<string, Price>> = {},
): Price | undefined {
  const key = `${provider}/${model}`
  return overrides[key] ?? PRICES[key]
}

export function costMicroUsd(
  price: Price,
  usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cacheReadTokens: number
    readonly cacheWriteTokens: number
  },
): number {
  return Math.round(
    usage.inputTokens * price.input +
      usage.cacheWriteTokens * price.cacheWrite +
      usage.cacheReadTokens * price.cacheRead +
      usage.outputTokens * price.output,
  )
}
