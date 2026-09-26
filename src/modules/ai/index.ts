/**
 * Public surface of the ai module — the only path to a model (docs/architecture.md,
 * LLM boundary). Callers define a TaskDefinition in their own prompts/ directory,
 * call callModel, and store the returned traces against the record they produce.
 */

export { callModel } from './service.js'
export { ModelTraceSchema } from './types.js'

export type { CallModel, CallModelArgs, CallModelSuccess } from './service.js'
export type { AiError, AiErrorCode, ModelTier, ModelTrace, TaskDefinition } from './types.js'
