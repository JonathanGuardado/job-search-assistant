import { z } from 'zod'

// Tuples shared with schema.ts, which types the text columns and CHECK constraints from them.
export const LOCATION_POLICIES = ['onsite', 'hybrid', 'remote', 'unknown'] as const
export const LocationPolicySchema = z.enum(LOCATION_POLICIES)
export type LocationPolicy = z.infer<typeof LocationPolicySchema>

export const EMPLOYMENT_TYPES = ['employee', 'contractor', 'eor', 'unknown'] as const
export const EmploymentTypeSchema = z.enum(EMPLOYMENT_TYPES)
export type EmploymentType = z.infer<typeof EmploymentTypeSchema>

// Ordered junior to senior: when a title states two ("Senior Staff"), the later one wins.
export const SENIORITIES = ['intern', 'junior', 'senior', 'lead', 'staff', 'principal'] as const
export const SenioritySchema = z.enum(SENIORITIES)
export type Seniority = z.infer<typeof SenioritySchema>

export const JOB_USER_STATES = ['new', 'saved', 'ignored', 'applied'] as const
export const JobUserStateValueSchema = z.enum(JOB_USER_STATES)
export type JobUserStateValue = z.infer<typeof JobUserStateValueSchema>

const minorUnits = z.number().int().nonnegative()

/**
 * An unposted salary is its own variant rather than nulls or zeros, so it
 * cannot be mistaken for a salary of zero or silently filled with an estimate.
 */
export const SalarySchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('unknown') }),
  z
    .object({
      source: z.literal('posted'),
      minMinor: minorUnits.nullable(),
      maxMinor: minorUnits.nullable(),
      currency: z.string().length(3),
    })
    .refine((s) => s.minMinor !== null || s.maxMinor !== null, {
      message: 'a posted salary needs a minimum or a maximum',
    })
    .refine((s) => s.minMinor === null || s.maxMinor === null || s.minMinor <= s.maxMinor, {
      message: 'salary minimum exceeds maximum',
    }),
])
export type Salary = z.infer<typeof SalarySchema>

/** A canonical posting: one per (source, external id), normalized from its newest raw version. */
export const JobSchema = z.object({
  id: z.uuid(),
  sourceId: z.uuid(),
  externalId: z.string().min(1),
  /** The duplicate this posting is linked to, or null if it is canonical itself (decision 0008). */
  canonicalJobId: z.uuid().nullable(),
  companyName: z.string().min(1),
  companyNormalized: z.string().min(1),
  /** Verbatim from the posting. Eligibility reads this, not titleNormalized. */
  title: z.string().min(1),
  titleNormalized: z.string().min(1),
  seniority: SenioritySchema.nullable(),
  description: z.string(),
  locationPolicy: LocationPolicySchema,
  locationText: z.string().nullable(),
  locationCountry: z.string().regex(/^[A-Z]{2}$/).nullable(),
  employmentType: EmploymentTypeSchema,
  salary: SalarySchema,
  applyUrl: z.url({ protocol: /^https?$/ }),
  postedAt: z.date().nullable(),
  fingerprint: z.string().min(1),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  closedAt: z.date().nullable(),
})
export type Job = z.infer<typeof JobSchema>

export const JobUserStateSchema = z.object({
  userId: z.uuid(),
  jobId: z.uuid(),
  state: JobUserStateValueSchema,
  updatedAt: z.date(),
})
export type JobUserState = z.infer<typeof JobUserStateSchema>

/** Queue payload: normalize one stored raw version into its job. */
export const JobNormalizePayloadSchema = z.object({ rawJobId: z.uuid() })
export type JobNormalizePayload = z.infer<typeof JobNormalizePayloadSchema>
