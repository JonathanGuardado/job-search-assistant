import type { DimensionStatus, Dimensions, SalaryCompatibility } from './types.js'

/*
 * The order a list of matches is shown in. There is no score (docs/domain-model.md): the
 * order compares a few dimensions in turn, and REVIEW_ORDER says which, so the page can
 * state it in words.
 */

export const REVIEW_ORDER = 'Closest to your target roles first, then the share of required skills your record shows, then fewest concerns.'

type Reviewable = { readonly dimensions: Dimensions; readonly concerns: readonly string[] }

const ROLE_RANK: Record<DimensionStatus, number> = { meets: 0, partial: 1, unknown: 2, not_stated: 2, gap: 3 }

/** A posting that names no required skill sits between one fully shown and one with gaps. */
function requiredShare(match: Reviewable): number {
  const findings = match.dimensions.requiredSkills.findings
  return findings.length === 0 ? 0.5 : findings.filter((f) => f.status === 'met').length / findings.length
}

/** For Array.prototype.sort. Jobs not matched (null) come last, in the order given. */
export function compareForReview(a: Reviewable | null, b: Reviewable | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return ROLE_RANK[a.dimensions.role.status] - ROLE_RANK[b.dimensions.role.status]
    || requiredShare(b) - requiredShare(a)
    || a.concerns.length - b.concerns.length
}

export type MatchSummary = {
  readonly requiredShown: number
  readonly requiredTotal: number
  readonly roleStatus: DimensionStatus
  /** The first concern, which is the worst. */
  readonly topConcern: string | null
  readonly salaryCompatibility: SalaryCompatibility
}

export function summarizeMatch(match: Reviewable & { readonly salaryCompatibility: SalaryCompatibility }): MatchSummary {
  const required = match.dimensions.requiredSkills.findings
  return {
    requiredShown: required.filter((f) => f.status === 'met').length,
    requiredTotal: required.length,
    roleStatus: match.dimensions.role.status,
    topConcern: match.concerns[0] ?? null,
    salaryCompatibility: match.salaryCompatibility,
  }
}
