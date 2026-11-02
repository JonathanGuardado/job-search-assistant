import type { Env } from '@/lib/env'
import { deepseekProvider } from './deepseek.js'
import { geminiProvider } from './gemini.js'
import { openaiProvider } from './openai.js'
import type { Provider } from './provider.js'
import type { ModelRole } from './types.js'

type RoleConfig = Pick<Env,
  'AI_PRIMARY_PROVIDER' | 'AI_PRIMARY_MODEL' | 'AI_PRIMARY_API_KEY' | 'AI_PRIMARY_REASONING' |
  'AI_SECONDARY_PROVIDER' | 'AI_SECONDARY_MODEL' | 'AI_SECONDARY_API_KEY' | 'AI_SECONDARY_REASONING'>

export type ConfiguredModel = {
  readonly provider: Provider
  /** The vendor's model id, sent to the API and used for pricing. */
  readonly id: string
  /** What traces record, when it says more than the id: the reasoning level, for example. */
  readonly name?: string
}

const settingsOf = (config: RoleConfig, role: ModelRole) => role === 'primary'
  ? { prefix: 'AI_PRIMARY', provider: config.AI_PRIMARY_PROVIDER, model: config.AI_PRIMARY_MODEL, key: config.AI_PRIMARY_API_KEY, reasoning: config.AI_PRIMARY_REASONING }
  : { prefix: 'AI_SECONDARY', provider: config.AI_SECONDARY_PROVIDER, model: config.AI_SECONDARY_MODEL, key: config.AI_SECONDARY_API_KEY, reasoning: config.AI_SECONDARY_REASONING }

// The same model reads differently with reasoning on, so its readings must not pass for the plain model's.
const nameOf = (model: string, reasoning: string | undefined) => reasoning && reasoning !== 'none' ? `${model}@reasoning-${reasoning}` : model

/** `provider/model` for a role, as traces and evals name it; null when the role is not configured. */
export function configuredModelName(config: RoleConfig, role: ModelRole): string | null {
  const { provider, model, reasoning } = settingsOf(config, role)
  return provider && model ? `${provider}/${nameOf(model, reasoning)}` : null
}

/**
 * A role's provider, model and key from `.env.local` (decision 0015). Required only when a
 * task in that role is called, not at boot; a missing setting stops only that role's tasks.
 */
export function configuredModel(config: RoleConfig, role: ModelRole): ConfiguredModel {
  const { prefix, provider, model, key, reasoning } = settingsOf(config, role)
  const missing = [!provider && `${prefix}_PROVIDER`, !model && `${prefix}_MODEL`, !key && `${prefix}_API_KEY`].filter(Boolean)
  if (!provider || !model || !key) throw new Error(`${missing.join(', ')} not set for the ${role} model`)
  if (reasoning && provider !== 'openai') throw new Error(`${prefix}_REASONING is only supported for openai`)
  const instance = provider === 'openai' ? openaiProvider(key, fetch, reasoning) : provider === 'deepseek' ? deepseekProvider(key) : geminiProvider(key)
  return { provider: instance, id: model, name: nameOf(model, reasoning) }
}
