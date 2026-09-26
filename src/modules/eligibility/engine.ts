import { RULES } from './rules.js'
import type {
  AssessmentStage,
  EligibilityClaims,
  EligibilityJob,
  EligibilityProfile,
  EligibilityVerdict,
  Evidence,
  RuleInput,
} from './types.js'

/**
 * Confidence is computed from stage provenance, never asked of a model.
 * Below MIN_CONFIDENCE the verdict is forced to needs_review regardless of what
 * the rules returned. See docs/eligibility-spec.md.
 */
const CONFIDENCE_BY_STAGE: Record<AssessmentStage, number> = {
  structured: 1.0,
  extracted: 0.8,
  partial: 0.6,
}

export const MIN_CONFIDENCE = 0.6

/**
 * Runs the ordered rule set. The first `fail` wins. Any `unknown` with no `fail`
 * yields needs_review carrying the open questions.
 *
 * A `fail` without a supporting quote is downgraded to needs_review: we do not
 * reject a job we cannot point at a sentence for.
 */
export function evaluateRules(
  profile: EligibilityProfile,
  job: EligibilityJob,
  claims: EligibilityClaims,
  stage: AssessmentStage,
): EligibilityVerdict {
  const input: RuleInput = { profile, job, claims }
  const confidence = CONFIDENCE_BY_STAGE[stage]
  const openQuestions: string[] = []
  const evidence: Evidence[] = []

  for (const rule of RULES) {
    if (!rule.appliesWhen(input)) continue
    const outcome = rule.evaluate(input)

    if (outcome.kind === 'unknown') {
      openQuestions.push(outcome.question)
      continue
    }

    if (outcome.kind === 'fail') {
      // Structured fields are their own evidence; extracted claims need a quote.
      if (stage !== 'structured' && outcome.quote === undefined) {
        openQuestions.push(
          `${outcome.reason} (no supporting sentence was found in the posting)`,
        )
        continue
      }
      if (outcome.quote !== undefined) {
        evidence.push({ ruleId: rule.id, quote: outcome.quote })
      }
      if (confidence < MIN_CONFIDENCE) break
      return {
        verdict: 'not_eligible',
        confidence,
        ruleId: rule.id,
        reason: outcome.reason,
        evidence,
      }
    }
  }

  if (openQuestions.length > 0 || confidence < MIN_CONFIDENCE) {
    return {
      verdict: 'needs_review',
      confidence,
      openQuestions:
        openQuestions.length > 0
          ? openQuestions
          : ['Extraction confidence was too low to decide.'],
    }
  }

  return { verdict: 'eligible', confidence, evidence }
}

/**
 * Stage 1: claims derived from structured fields alone, with no model call.
 * Everything the posting text would have to tell us stays 'unspecified'.
 */
export function claimsFromStructuredFields(job: EligibilityJob): EligibilityClaims {
  return {
    remoteScope: { kind: 'unspecified' },
    authorization: { required: 'unspecified' },
    timezone: { kind: 'unspecified' },
    employmentType: { kind: 'unspecified' },
    relocation: { required: 'unspecified' },
    onsite:
      job.locationPolicy === 'unknown' ? { kind: 'unspecified' } : { kind: job.locationPolicy },
  }
}

/**
 * Every quote must appear verbatim in the source text. A claim whose quote does
 * not is reset to 'unspecified' — the cheapest hallucination check available,
 * and it is not optional.
 *
 * Returns the sanitized claims and whether anything was stripped (which
 * downgrades the stage to 'partial').
 */
export function validateQuotes(
  claims: EligibilityClaims,
  sourceText: string,
): { claims: EligibilityClaims; stripped: number } {
  const haystack = normalizeWhitespace(sourceText).toLowerCase()
  let stripped = 0

  const appearsVerbatim = (quote: string | undefined): boolean => {
    if (quote === undefined) return true
    const needle = normalizeWhitespace(quote).toLowerCase()
    return needle.length > 0 && haystack.includes(needle)
  }

  const keep = (quote: string | undefined): boolean => {
    const valid = appearsVerbatim(quote)
    if (!valid) stripped += 1
    return valid
  }

  const sanitized: EligibilityClaims = {
    remoteScope: keep(claims.remoteScope.quote)
      ? claims.remoteScope
      : { kind: 'unspecified' },
    authorization: keep(claims.authorization.quote)
      ? claims.authorization
      : { required: 'unspecified' },
    timezone: keep(claims.timezone.quote) ? claims.timezone : { kind: 'unspecified' },
    employmentType: keep(claims.employmentType.quote)
      ? claims.employmentType
      : { kind: 'unspecified' },
    relocation: keep(claims.relocation.quote)
      ? claims.relocation
      : { required: 'unspecified' },
    onsite: keep(claims.onsite.quote) ? claims.onsite : { kind: 'unspecified' },
  }

  return { claims: sanitized, stripped }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function stageFor(stripped: number): AssessmentStage {
  return stripped > 0 ? 'partial' : 'extracted'
}

/**
 * Full assessment. `extract` is injected so the rules can be tested without a
 * model and so stage 1 can short-circuit before any model call is made.
 */
export async function assessEligibility(
  profile: EligibilityProfile,
  job: EligibilityJob,
  extract: (description: string) => Promise<EligibilityClaims>,
): Promise<{ verdict: EligibilityVerdict; claims: EligibilityClaims; stage: AssessmentStage }> {
  const structuredClaims = claimsFromStructuredFields(job)
  const structuredVerdict = evaluateRules(profile, job, structuredClaims, 'structured')

  if (structuredVerdict.verdict !== 'needs_review') {
    return { verdict: structuredVerdict, claims: structuredClaims, stage: 'structured' }
  }

  const extracted = await extract(job.description)
  const { claims, stripped } = validateQuotes(extracted, job.description)
  const stage = stageFor(stripped)

  return { verdict: evaluateRules(profile, job, claims, stage), claims, stage }
}
