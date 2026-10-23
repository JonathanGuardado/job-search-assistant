import { z } from 'zod'

/*
 * An application the candidate sent, and every stage it moved through (decision 0012).
 * Model-free: nothing here is generated or decided by a model.
 */

/**
 * Where an application stands. Any stage may follow any other: hiring is not linear, and a
 * rejection sometimes comes back as an interview. Every move is kept in application_events.
 */
export const APPLICATION_STATUSES = ['applied', 'interviewing', 'offer', 'accepted', 'rejected', 'withdrawn', 'no_response'] as const
export const ApplicationStatusSchema = z.enum(APPLICATION_STATUSES)
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>

const isoDate = z.iso.date()
const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null).nullable()

/** Who the candidate dealt with. Every field optional; an empty contact is stored as null. */
export const ContactSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.email().max(320).optional(),
  url: z.url({ protocol: /^https?$/ }).max(2000).optional(),
})
export type Contact = z.infer<typeof ContactSchema>

/** What the candidate asked for, in minor units of its currency. */
export const SalaryAskedSchema = z.object({
  amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
})
export type SalaryAsked = z.infer<typeof SalaryAskedSchema>

export const NewApplicationSchema = z.object({
  jobId: z.uuid(),
  /** The day it was sent; may be in the past ("I applied yesterday"), never in the future. */
  appliedOn: isoDate,
  /** The resume version sent, or null when it was not one stored here. */
  resumeId: z.uuid().nullable(),
  salaryAsked: SalaryAskedSchema.nullable(),
  contact: ContactSchema.nullable(),
  notes: optionalText(5000),
  /** Where it was submitted; null means the job's own apply URL. */
  sourceUrl: z.url({ protocol: /^https?$/ }).max(2000).nullable(),
})
export type NewApplication = z.infer<typeof NewApplicationSchema>

export const ApplicationEditSchema = z.object({
  appliedOn: isoDate,
  resumeId: z.uuid().nullable(),
  salaryAsked: SalaryAskedSchema.nullable(),
  contact: ContactSchema.nullable(),
  notes: optionalText(5000),
  /** Why it ended, in the candidate's words: "Role filled internally". */
  outcomeReason: optionalText(1000),
})
export type ApplicationEdit = z.infer<typeof ApplicationEditSchema>

export const StatusChangeSchema = z.object({
  applicationId: z.uuid(),
  to: ApplicationStatusSchema,
  /** The day it happened, which may be before the day it was recorded. Never in the future. */
  occurredOn: isoDate,
  note: optionalText(1000),
})
export type StatusChange = z.infer<typeof StatusChangeSchema>

export type Application = {
  readonly id: string
  readonly userId: string
  readonly jobId: string
  /** The posting version applied to; the posting can be rebuilt from it after the job closes. */
  readonly rawJobId: string
  readonly status: ApplicationStatus
  readonly appliedOn: string
  readonly resumeId: string | null
  readonly salaryAsked: SalaryAsked | null
  readonly sourceUrl: string
  readonly contact: Contact | null
  readonly notes: string | null
  readonly outcomeReason: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export type ApplicationEvent = {
  readonly id: string
  readonly applicationId: string
  /** null on the event that created the application. */
  readonly fromStatus: ApplicationStatus | null
  readonly toStatus: ApplicationStatus
  readonly note: string | null
  readonly occurredOn: string
  readonly recordedAt: Date
}
