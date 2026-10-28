import { z } from 'zod'
import { getEnv } from '@/lib/env'
import { logEvent } from '@/lib/log'
import { err, ok, type Result } from '@/lib/result'
import { configuredModel, configuredModelName, type ConfiguredModel } from './configured-provider.js'
import { costMicroUsd, priceOf, type Price } from './pricing.js'
import type { ProviderMessage } from './provider.js'
import type { AiError, ModelRole, ModelTrace, TaskDefinition } from './types.js'

// The first attempt plus one retry with the validation error appended (docs/conventions.md).
const MAX_ATTEMPTS = 2

export type ModelCallerDeps = {
  /** The model a role runs on. Throws when the role is not configured. */
  readonly model: (role: ModelRole) => ConfiguredModel
  readonly prices?: Readonly<Record<string, Price>>
  readonly onTrace?: (trace: ModelTrace) => void
}

export type CallModelArgs<I, S extends z.ZodType> = {
  readonly task: TaskDefinition<I>
  readonly schema: S
  readonly input: I
}

export type CallModelSuccess<T> = { readonly value: T; readonly traces: readonly ModelTrace[] }

function parseOutput<S extends z.ZodType>(
  schema: S,
  text: string,
): Result<z.output<S>, string> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return err(`output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = schema.safeParse(json)
  return parsed.success ? ok(parsed.data) : err(z.prettifyError(parsed.error))
}

// Raw output can contain candidate data, so logs carry its size; the full text lives on the trace.
function logTrace(trace: ModelTrace): void {
  const { rawOutput, ...rest } = trace
  logEvent('ai.model_call', { ...rest, rawOutputChars: rawOutput.length })
}

export function createModelCaller(deps: ModelCallerDeps) {
  const emit = deps.onTrace ?? logTrace

  return async function callModel<I, S extends z.ZodType>({
    task,
    schema,
    input,
  }: CallModelArgs<I, S>): Promise<Result<CallModelSuccess<z.output<S>>, AiError>> {
    const { provider, id: model } = deps.model(task.role)
    const price = priceOf(provider.name, model, deps.prices)
    // A configuration error, not a domain failure: fail before spending anything.
    if (!price) throw new Error(`no price for model ${model} on ${provider.name}; configure AI_MODEL_PRICING`)

    const messages: ProviderMessage[] = [{ role: 'user', content: task.render(input) }]
    const traces: ModelTrace[] = []
    const fail = (code: AiError['code'], message: string) => err<AiError>({ code, message, traces })

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const started = performance.now()
      const response = await provider.complete({
        model,
        system: task.system,
        messages,
        maxTokens: task.maxTokens,
        outputSchema: schema,
      })
      if (!response.ok) {
        logEvent('ai.provider_failed', { task: task.name, model, attempt, error: response.error.message })
        return fail(response.error.code === 'rate_limited' ? 'rate_limited' : 'upstream_failed', response.error.message)
      }

      const { text, stop, rawStopReason, usage } = response.value
      const parsed = stop === 'complete' ? parseOutput(schema, text) : undefined
      const trace: ModelTrace = {
        task: task.name,
        taskVersion: task.version,
        provider: provider.name,
        model,
        attempt,
        stopReason: rawStopReason,
        ...usage,
        costMicroUsd: costMicroUsd(price, usage),
        latencyMs: Math.round(performance.now() - started),
        rawOutput: text,
        validationError: parsed && !parsed.ok ? parsed.error : null,
      }
      traces.push(trace)
      emit(trace)

      if (stop === 'refused') return fail('refused', `${task.name}: the model declined the request`)
      if (stop === 'truncated') return fail('truncated', `${task.name}: output hit ${rawStopReason}`)
      if (!parsed) return fail('upstream_failed', `${task.name}: unexpected stop reason ${rawStopReason}`)
      if (parsed.ok) return ok({ value: parsed.value, traces })

      messages.push(
        { role: 'assistant', content: text },
        {
          role: 'user',
          content: `Your previous output failed validation:\n${parsed.error}\nReturn corrected JSON only.`,
        },
      )
    }

    return fail('validation_failed', `${task.name}: output failed validation ${MAX_ATTEMPTS} times`)
  }
}

export type CallModel = ReturnType<typeof createModelCaller>

let defaultCaller: CallModel | undefined

/**
 * The only way the rest of the app reaches a model. Built on first use so that
 * importing this module (tests, the web app) needs no API key.
 */
export const callModel: CallModel = (args) => {
  if (!defaultCaller) {
    const models = new Map<ModelRole, ConfiguredModel>()
    defaultCaller = createModelCaller({
      model: (role) => {
        const model = models.get(role) ?? configuredModel(getEnv(), role)
        models.set(role, model)
        return model
      },
      prices: getEnv().AI_MODEL_PRICING,
    })
  }
  return defaultCaller(args)
}

/** `provider/model` a role is configured with, for evals that store results per model. */
export const modelNameOf = (role: ModelRole): string | null => configuredModelName(getEnv(), role)
