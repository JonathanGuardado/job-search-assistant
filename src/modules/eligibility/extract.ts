import { z } from 'zod'
import { callModel, type AiError, type CallModelSuccess } from '@/modules/ai'
import { ok, type Result } from '@/lib/result'
import { extractClaimsTask } from './prompts/extract-claims.js'
import {
  AuthorizationClaimSchema,
  EmploymentTypeClaimSchema,
  OnsiteClaimSchema,
  RelocationClaimSchema,
  RemoteScopeClaimSchema,
  TimezoneClaimSchema,
  type EligibilityClaims,
} from './types.js'

/** Stage 2: the model call, injectable so tests and the eval cache can stand in for it. */
export type ExtractClaims = (postingText: string) => Promise<Result<CallModelSuccess<EligibilityClaims>, AiError>>

// What the model must return: each claim's quote is a required key (null when the claim
// is unspecified). Constrained decoding skips optional keys, and an unquoted claim is
// discarded, so an optional quote cost correct answers (eval run of prompt v2).
const requiredQuote = { quote: z.string().min(1).nullable() }
export const ExtractionOutputSchema = z.object({
  remoteScope: RemoteScopeClaimSchema.extend(requiredQuote),
  authorization: AuthorizationClaimSchema.extend(requiredQuote),
  timezone: TimezoneClaimSchema.extend(requiredQuote),
  employmentType: EmploymentTypeClaimSchema.extend(requiredQuote),
  relocation: RelocationClaimSchema.extend(requiredQuote),
  onsite: OnsiteClaimSchema.extend(requiredQuote),
})
type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>

const withoutNullQuote = <C extends { quote: string | null }>({ quote, ...claim }: C) =>
  quote === null ? claim : { ...claim, quote }

export function claimsFromOutput(output: ExtractionOutput): EligibilityClaims {
  return {
    remoteScope: withoutNullQuote(output.remoteScope),
    authorization: withoutNullQuote(output.authorization),
    timezone: withoutNullQuote(output.timezone),
    employmentType: withoutNullQuote(output.employmentType),
    relocation: withoutNullQuote(output.relocation),
    onsite: withoutNullQuote(output.onsite),
  }
}

export const extractClaimsWithModel: ExtractClaims = async (text) => {
  const result = await callModel({ task: extractClaimsTask, schema: ExtractionOutputSchema, input: { text } })
  return result.ok ? ok({ value: claimsFromOutput(result.value.value), traces: result.value.traces }) : result
}
