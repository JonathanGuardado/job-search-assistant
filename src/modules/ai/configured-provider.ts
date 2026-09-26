import type { Env } from '@/lib/env'
import { deepseekProvider } from './deepseek.js'
import { geminiProvider } from './gemini.js'
import type { Provider } from './provider.js'

/** Credentials are required only when a model call is made, not when the app boots. */
export function configuredProvider(config: Pick<Env, 'AI_PROVIDER' | 'AI_API_KEY'>): Provider {
  if (!config.AI_API_KEY) throw new Error('AI_API_KEY is not set')
  return config.AI_PROVIDER === 'deepseek'
    ? deepseekProvider(config.AI_API_KEY)
    : geminiProvider(config.AI_API_KEY)
}
