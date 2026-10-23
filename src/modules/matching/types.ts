import { z } from 'zod'

// ---------------------------------------------------------------------------
// What a posting asks for: extracted once per text version, shared by every candidate.

export const IMPORTANCES = ['required', 'preferred'] as const
export const ImportanceSchema = z.enum(IMPORTANCES)
export type Importance = z.infer<typeof ImportanceSchema>

const quote = z.string().min(1)

export const SkillRequirementSchema = z.object({
  /**
   * The skill as commonly written ("PostgreSQL"), or the skills a posting accepts in its
   * place ("AWS, Azure, or GCP"): any one of them satisfies the requirement (prompt v2).
   */
  names: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  importance: ImportanceSchema,
  minYears: z.number().min(0).max(40).nullable(),
  quote,
})
export type SkillRequirement = z.infer<typeof SkillRequirementSchema>

export const ExperienceRequirementSchema = z.object({ minYears: z.number().min(0).max(40), quote })
export type ExperienceRequirement = z.infer<typeof ExperienceRequirementSchema>

export const LanguageRequirementSchema = z.object({
  /** ISO 639-1, matching the codes a candidate selects in settings. */
  language: z.string().regex(/^[a-z]{2}$/),
  importance: ImportanceSchema,
  quote,
})
export type LanguageRequirement = z.infer<typeof LanguageRequirementSchema>

/** Degrees, certifications, domain knowledge: shown on the card, never compared. */
export const OtherRequirementSchema = z.object({ text: z.string().trim().min(1).max(200), importance: ImportanceSchema, quote })
export type OtherRequirement = z.infer<typeof OtherRequirementSchema>

export const JobRequirementsSchema = z.object({
  skills: z.array(SkillRequirementSchema),
  experience: ExperienceRequirementSchema.nullable(),
  languages: z.array(LanguageRequirementSchema),
  other: z.array(OtherRequirementSchema),
})
export type JobRequirements = z.infer<typeof JobRequirementsSchema>

export const NO_REQUIREMENTS: JobRequirements = { skills: [], experience: null, languages: [], other: [] }

// ---------------------------------------------------------------------------
// What the comparison produces. Code decides every status; nothing here comes from a model.

/** Where on the candidate's record a requirement is shown to be met. */
export const CandidateEvidenceSchema = z.object({
  careerItemId: z.uuid(),
  /** "Senior Software Engineer at FullStack Labs" */
  label: z.string(),
  /** listed in the item's technologies, found in its text, or implied by a listed skill */
  via: z.enum(['technologies', 'text', 'implied']),
  /** The technology or sentence that matched. */
  text: z.string(),
  isVerified: z.boolean(),
})
export type CandidateEvidence = z.infer<typeof CandidateEvidenceSchema>

export const FINDING_STATUSES = ['met', 'short', 'missing', 'unknown'] as const
export const FindingSchema = z.object({
  requirement: z.string(),
  importance: ImportanceSchema,
  /** The posting's words, when the requirement came from its text. */
  quote: z.string().nullable(),
  /** met; short: has it, with fewer years than asked; missing; unknown: cannot be compared. */
  status: z.enum(FINDING_STATUSES),
  /** Plain statement of the comparison, e.g. "asks 5+ years; you have at least 3". */
  note: z.string().nullable(),
  evidence: z.array(CandidateEvidenceSchema),
})
export type Finding = z.infer<typeof FindingSchema>
export type FindingStatus = Finding['status']

export const DIMENSION_KEYS = [
  'requiredSkills', 'preferredSkills', 'experience', 'languages', 'role', 'seniority', 'salary', 'employmentType', 'preferences',
] as const
export type DimensionKey = (typeof DIMENSION_KEYS)[number]

/** not_stated: the posting (or the candidate's profile) says nothing this dimension can use. */
export const DIMENSION_STATUSES = ['meets', 'partial', 'gap', 'unknown', 'not_stated'] as const
export const DimensionSchema = z.object({
  status: z.enum(DIMENSION_STATUSES),
  findings: z.array(FindingSchema),
})
export type Dimension = z.infer<typeof DimensionSchema>
export type DimensionStatus = Dimension['status']

export const DimensionsSchema = z.object({
  requiredSkills: DimensionSchema, preferredSkills: DimensionSchema, experience: DimensionSchema, languages: DimensionSchema,
  role: DimensionSchema, seniority: DimensionSchema, salary: DimensionSchema, employmentType: DimensionSchema, preferences: DimensionSchema,
}) satisfies z.ZodType<Record<DimensionKey, Dimension>>
export type Dimensions = z.infer<typeof DimensionsSchema>

export const SALARY_COMPATIBILITIES = ['above', 'within', 'below', 'unknown'] as const
export type SalaryCompatibility = (typeof SALARY_COMPATIBILITIES)[number]

export type MatchResult = {
  readonly dimensions: Dimensions
  readonly salaryCompatibility: SalaryCompatibility
  /** Posting requirements the candidate's record shows, with the evidence. */
  readonly met: readonly Finding[]
  /** Posting requirements it does not show, or shows with fewer years than asked. */
  readonly missing: readonly Finding[]
  /** One line each, worst first: what the candidate should know before applying. */
  readonly concerns: readonly string[]
}

/**
 * Bump on any change to how requirements are compared or explained: stored matches are per version.
 * v2: a skill requirement is met by any one of the skills it names.
 */
export const MATCH_ENGINE_VERSION = 2
