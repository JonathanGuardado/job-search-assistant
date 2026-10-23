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
 * Every claim must rest on a quote that appears verbatim in the posting. A claim whose
 * quote does not appear, or which states something without any quote, is reset to
 * 'unspecified' — the cheapest hallucination check available, and it is not optional.
 *
 * Returns the sanitized claims and how many were reset, split into quotes that do not
 * appear (`stripped`) and statements made without a quote (`unquoted`). Either
 * downgrades the stage to 'partial'.
 */
export function validateQuotes(
  claims: EligibilityClaims,
  job: EligibilityJob,
): { claims: EligibilityClaims; stripped: number; unquoted: number } {
  const haystack = normalizeWhitespace(postingText(job)).toLowerCase()
  let stripped = 0
  let unquoted = 0

  const supported = (stated: boolean, quote: string | undefined): boolean => {
    if (!stated) return true
    const needle = quote === undefined ? '' : normalizeWhitespace(quote).toLowerCase()
    if (needle.length === 0) {
      unquoted += 1
      return false
    }
    const valid = haystack.includes(needle)
    if (!valid) stripped += 1
    return valid
  }
  const answered = (value: boolean | 'unspecified' | undefined) => value === true || value === false

  const { remoteScope, authorization, timezone, employmentType, relocation, onsite } = claims
  const sanitized: EligibilityClaims = {
    remoteScope: supported(remoteScope.kind !== 'unspecified', remoteScope.quote) ? remoteScope : { kind: 'unspecified' },
    authorization: supported(answered(authorization.required) || answered(authorization.sponsorshipOffered), authorization.quote)
      ? authorization
      : { required: 'unspecified' },
    timezone: supported(timezone.kind !== 'unspecified', timezone.quote) ? timezone : { kind: 'unspecified' },
    employmentType: supported(employmentType.kind !== 'unspecified', employmentType.quote) ? employmentType : { kind: 'unspecified' },
    relocation: supported(answered(relocation.required) || answered(relocation.assistanceOffered), relocation.quote)
      ? relocation
      : { required: 'unspecified' },
    onsite: supported(onsite.kind !== 'unspecified' || (onsite.countries ?? []).length > 0, onsite.quote) ? onsite : { kind: 'unspecified' },
  }

  return { claims: sanitized, stripped, unquoted }
}

/**
 * The posting names a place but never says remote, hybrid or onsite, nor where a remote
 * worker may live (engine v3). Such a verdict stays needs_review: a location is not proof
 * of an office (CLAUDE.md rule 2). The flag lets matching skip it and the jobs view group it.
 */
export function listsOnlyALocation(claims: EligibilityClaims, job: EligibilityJob): boolean {
  const statesArrangement = claims.onsite.kind !== 'unspecified' || claims.remoteScope.kind !== 'unspecified' || job.locationPolicy !== 'unknown'
  const namesPlace = job.locationText !== null || (claims.onsite.countries ?? []).length > 0
  return !statesArrangement && namesPlace
}

/** Everything the model reads, and so everything a quote may come from. */
export function postingText(job: EligibilityJob): string {
  return [`Title: ${job.title}`, `Location: ${job.locationText ?? 'not stated'}`, '', job.description].join('\n')
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
  extract: (postingText: string) => Promise<EligibilityClaims>,
): Promise<{ verdict: EligibilityVerdict; claims: EligibilityClaims; stage: AssessmentStage }> {
  const structuredClaims = claimsFromStructuredFields(job)
  const structuredVerdict = evaluateRules(profile, job, structuredClaims, 'structured')

  // D1: structured fields can prove a rejection, but a structured "eligible" only means
  // the posting has not been read yet, so anything short of a rejection reads it.
  if (structuredVerdict.verdict === 'not_eligible') {
    return { verdict: structuredVerdict, claims: structuredClaims, stage: 'structured' }
  }

  const extracted = await extract(postingText(job))
  const { claims, stripped, unquoted } = validateQuotes(extracted, job)
  const stage = stageFor(stripped + unquoted)

  return { verdict: evaluateRules(profile, job, claims, stage), claims, stage }
}
