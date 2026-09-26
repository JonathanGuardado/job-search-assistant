import { z } from 'zod'

// Tuples shared with schema.ts, which types the text columns and CHECK constraints from them.
export const LOCATION_POLICIES = ['onsite', 'hybrid', 'remote', 'unknown'] as const
export const LocationPolicySchema = z.enum(LOCATION_POLICIES)
export type LocationPolicy = z.infer<typeof LocationPolicySchema>

export const EMPLOYMENT_TYPES = ['employee', 'contractor', 'eor', 'unknown'] as const
export const EmploymentTypeSchema = z.enum(EMPLOYMENT_TYPES)
export type EmploymentType = z.infer<typeof EmploymentTypeSchema>

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

const JobFieldsSchema = z.object({
  companyName: z.string().min(1),
  companyNormalized: z.string().min(1),
  title: z.string().min(1),
  titleNormalized: z.string().min(1),
  description: z.string(),
  locationPolicy: LocationPolicySchema,
  locationText: z.string().nullable(),
  employmentType: EmploymentTypeSchema,
  salary: SalarySchema,
  applyUrl: z.url(),
  fingerprint: z.string().min(1),
})

export const NewJobSchema = JobFieldsSchema.extend({
  /** When the posting was observed. Becomes both first_seen_at and last_seen_at. */
  seenAt: z.date(),
})
export type NewJob = z.infer<typeof NewJobSchema>

export const JobSchema = JobFieldsSchema.extend({
  id: z.uuid(),
  canonicalJobId: z.uuid().nullable(),
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

/** Queue payload. Dates cross Redis as ISO strings, hence the coercion. */
export const JobSeenPayloadSchema = z.object({
  jobId: z.uuid(),
  seenAt: z.coerce.date(),
})
export type JobSeenPayload = z.infer<typeof JobSeenPayloadSchema>
