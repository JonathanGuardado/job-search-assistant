import { z } from 'zod'
import { callModel, type AiError, type CallModelSuccess } from '@/modules/ai'
import { ok, type Result } from '@/lib/result'
import { extractRequirementsTask } from './prompts/extract-requirements.js'
import {
  ExperienceRequirementSchema,
  LanguageRequirementSchema,
  OtherRequirementSchema,
  SkillRequirementSchema,
  type JobRequirements,
} from './types.js'

/** The model call, injectable so tests and the eval cache can stand in for it. */
export type ExtractRequirements = (postingText: string) => Promise<Result<CallModelSuccess<JobRequirements>, AiError>>

// `experience` is a required key that may be null: constrained decoding skips optional
// keys (eligibility eval, prompt v2), and an unquoted entry is discarded anyway.
export const RequirementsOutputSchema = z.object({
  skills: z.array(SkillRequirementSchema),
  experience: z.object({ minYears: ExperienceRequirementSchema.shape.minYears.nullable(), quote: z.string().nullable() }),
  languages: z.array(LanguageRequirementSchema),
  other: z.array(OtherRequirementSchema),
})
type RequirementsOutput = z.infer<typeof RequirementsOutputSchema>

export function requirementsFromOutput(output: RequirementsOutput): JobRequirements {
  const { minYears, quote } = output.experience
  return { ...output, experience: minYears !== null && quote !== null && quote.trim() !== '' ? { minYears, quote } : null }
}

export const extractRequirementsWithModel: ExtractRequirements = async (text) => {
  const result = await callModel({ task: extractRequirementsTask, schema: RequirementsOutputSchema, input: { text } })
  return result.ok ? ok({ value: requirementsFromOutput(result.value.value), traces: result.value.traces }) : result
}

/** Everything the model reads, and so everything a quote may come from. */
export function postingText(job: { readonly title: string; readonly description: string }): string {
  return [`Title: ${job.title}`, '', job.description].join('\n')
}

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Every entry must rest on a quote found verbatim in the posting; the rest are dropped.
 * Re-run on every comparison, so stored requirements are never trusted blindly.
 */
export function validateRequirements(requirements: JobRequirements, text: string): { requirements: JobRequirements; stripped: number; quoted: number } {
  const haystack = normalizeWhitespace(text)
  let stripped = 0
  let quoted = 0
  const isFound = (quote: string) => {
    quoted += 1
    const found = haystack.includes(normalizeWhitespace(quote))
    if (!found) stripped += 1
    return found
  }
  const experience = requirements.experience !== null && isFound(requirements.experience.quote) ? requirements.experience : null
  return {
    requirements: {
      skills: requirements.skills.filter((skill) => isFound(skill.quote)),
      experience,
      languages: requirements.languages.filter((language) => isFound(language.quote)),
      other: requirements.other.filter((other) => isFound(other.quote)),
    },
    stripped,
    quoted,
  }
}
