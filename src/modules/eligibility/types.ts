import { z } from 'zod'

/**
 * Claims are what the model extracts. They are never conclusions.
 * Every field defaults to 'unspecified' — that is the CORRECT answer when the
 * posting is silent. See docs/eligibility-spec.md.
 */

export const RegionSchema = z.enum(['worldwide', 'latam', 'emea', 'apac', 'namer'])
export type Region = z.infer<typeof RegionSchema>

const quote = z.string().min(1).optional()

export const RemoteScopeClaimSchema = z.object({
  kind: z.enum(['worldwide', 'regions', 'countries', 'none', 'unspecified']),
  regions: z.array(RegionSchema).optional(),
  /** ISO 3166-1 alpha-2 */
  countries: z.array(z.string().length(2)).optional(),
  quote,
})

export const AuthorizationClaimSchema = z.object({
  required: z.union([z.boolean(), z.literal('unspecified')]),
  countries: z.array(z.string().length(2)).optional(),
  sponsorshipOffered: z.union([z.boolean(), z.literal('unspecified')]).optional(),
  quote,
})

export const TimezoneClaimSchema = z.object({
  kind: z.enum(['overlap', 'fixed', 'none', 'unspecified']),
  /** IANA zone, e.g. America/Los_Angeles */
  reference: z.string().optional(),
  overlapHours: z.number().min(0).max(24).optional(),
  quote,
})

export const EmploymentTypeClaimSchema = z.object({
  kind: z.enum(['employee', 'contractor', 'eor', 'either', 'unspecified']),
  quote,
})

export const RelocationClaimSchema = z.object({
  required: z.union([z.boolean(), z.literal('unspecified')]),
  assistanceOffered: z.union([z.boolean(), z.literal('unspecified')]).optional(),
  quote,
})

export const OnsiteClaimSchema = z.object({
  kind: z.enum(['onsite', 'hybrid', 'remote', 'unspecified']),
  daysInOffice: z.number().min(0).max(7).optional(),
  /** ISO 3166-1 alpha-2 of where an onsite or hybrid role is. Greenhouse never gives this structurally. */
  countries: z.array(z.string().length(2)).optional(),
  quote,
})

export const EligibilityClaimsSchema = z.object({
  remoteScope: RemoteScopeClaimSchema,
  authorization: AuthorizationClaimSchema,
  timezone: TimezoneClaimSchema,
  employmentType: EmploymentTypeClaimSchema,
  relocation: RelocationClaimSchema,
  onsite: OnsiteClaimSchema,
})

export type EligibilityClaims = z.infer<typeof EligibilityClaimsSchema>

export const UNSPECIFIED_CLAIMS: EligibilityClaims = {
  remoteScope: { kind: 'unspecified' },
  authorization: { required: 'unspecified' },
  timezone: { kind: 'unspecified' },
  employmentType: { kind: 'unspecified' },
  relocation: { required: 'unspecified' },
  onsite: { kind: 'unspecified' },
}

/** Rules */

export const RULE_IDS = [
  'onsite-requires-relocation',
  'remote-scope-excludes-country',
  'authorization-missing',
  'timezone-overlap-impossible',
  'employment-type-mismatch',
  'salary-below-floor',
  'relocation-required',
] as const

export type RuleId = (typeof RULE_IDS)[number]

export type RuleOutcome =
  | { kind: 'pass' }
  | { kind: 'fail'; reason: string; quote?: string }
  | { kind: 'unknown'; question: string }

export type RuleInput = {
  readonly profile: EligibilityProfile
  readonly job: EligibilityJob
  readonly claims: EligibilityClaims
}

export type Rule = {
  readonly id: RuleId
  /** False means the rule is irrelevant here — not that it passed. */
  readonly appliesWhen: (input: RuleInput) => boolean
  readonly evaluate: (input: RuleInput) => RuleOutcome
}

/** The slice of the candidate profile the rules read. */
export type EligibilityProfile = {
  readonly country: string
  readonly timezone: string
  readonly workAuthorizations: ReadonlyArray<{ country: string; type: string }>
  readonly willingToRelocate: boolean
  readonly allowedRegions: ReadonlyArray<Region | string>
  readonly employmentTypes: ReadonlyArray<'employee' | 'contractor' | 'eor'>
  readonly salaryFloorMinor: number | null
  readonly salaryCurrency: string | null
  /** Which constraints may produce not_eligible. Everything else is a preference. */
  readonly hardConstraints: ReadonlySet<HardConstraintKey>
  /** Working window in local time, 24h. Defaults to 9–18. */
  readonly workingHours?: { start: number; end: number }
}

export const HARD_CONSTRAINT_KEYS = [
  'location',
  'authorization',
  'relocation',
  'timezone',
  'employmentType',
  'salary',
] as const

export type HardConstraintKey = (typeof HARD_CONSTRAINT_KEYS)[number]

/** authorization and relocation are always hard — see docs/domain-model.md. */
export const ALWAYS_HARD: ReadonlySet<HardConstraintKey> = new Set([
  'authorization',
  'relocation',
])

/** The slice of the job the rules read. */
export type EligibilityJob = {
  readonly id: string
  /** Title and location line are part of the posting: quotes may come from them. */
  readonly title: string
  readonly locationText: string | null
  readonly description: string
  readonly locationPolicy: 'onsite' | 'hybrid' | 'remote' | 'unknown'
  readonly locationCountry: string | null
  readonly salaryMinMinor: number | null
  readonly salaryMaxMinor: number | null
  readonly salaryCurrency: string | null
  readonly salarySource: 'posted' | 'unknown'
}

/** Verdicts */

export type Evidence = { readonly ruleId: RuleId; readonly quote: string }

export type EligibilityVerdict =
  | {
      readonly verdict: 'eligible'
      readonly confidence: number
      readonly evidence: readonly Evidence[]
    }
  | {
      readonly verdict: 'not_eligible'
      readonly confidence: number
      readonly ruleId: RuleId
      readonly reason: string
      readonly evidence: readonly Evidence[]
    }
  | {
      readonly verdict: 'needs_review'
      readonly confidence: number
      readonly openQuestions: readonly string[]
    }

export const ASSESSMENT_STAGES = ['structured', 'extracted', 'partial'] as const
export type AssessmentStage = (typeof ASSESSMENT_STAGES)[number]

export const VERDICTS = ['eligible', 'not_eligible', 'needs_review'] as const
export type Verdict = (typeof VERDICTS)[number]

/** Why, stored with every assessment: the deciding rule, or the questions left open. */
export type AssessmentReasons =
  | { readonly ruleId: RuleId; readonly reason: string }
  | { readonly openQuestions: readonly string[] }
  | Record<string, never>

export const ENGINE_VERSION = 1
