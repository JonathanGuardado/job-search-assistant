import { z } from 'zod'
import type { SavedAnswerValue } from './readiness.js'

/*
 * What the candidate gives once and every application form reuses (decision 0013).
 */

const url = z.url({ protocol: /^https?$/ }).max(2000)

export const ApplicantDetailsSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.email().max(320),
  phone: z.string().trim().min(1).max(40).nullable(),
  linkedinUrl: url.nullable(),
  githubUrl: url.nullable(),
  websiteUrl: url.nullable(),
})
export type ApplicantDetails = z.infer<typeof ApplicantDetailsSchema>

export const SavedAnswerValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().trim().min(1).max(10_000) }),
  z.object({ kind: z.literal('choice'), labels: z.array(z.string().trim().min(1).max(500)).min(1).max(50) }),
])

/** An answer as the candidate gives it: the question's wording and their answer to it. */
export const SaveAnswerSchema = z.object({
  label: z.string().trim().min(1).max(2000),
  answer: SavedAnswerValueSchema,
  /** For this job only ("why this role?"); absent or null answers every job asking it. */
  jobId: z.uuid().nullable().optional(),
})
export type SaveAnswer = z.infer<typeof SaveAnswerSchema>

/** owner: written by the candidate. draft: a draft they accepted, edited or not (decision 0014). */
export const ANSWER_ORIGINS = ['owner', 'draft'] as const
export type AnswerOrigin = (typeof ANSWER_ORIGINS)[number]

export type SavedAnswer = {
  readonly questionKey: string
  /** Null: answers every job asking the question. */
  readonly jobId: string | null
  readonly label: string
  readonly answer: SavedAnswerValue
  readonly origin: AnswerOrigin
  readonly updatedAt: Date
}

export const DRAFT_METHODS = ['profile', 'experience', 'motivation'] as const
export type DraftMethod = (typeof DRAFT_METHODS)[number]
/** drafted: offered to the candidate. no_basis: the record cannot answer it. rejected: failed the grounding check. */
export const DRAFT_STATUSES = ['drafted', 'no_basis', 'rejected'] as const
export type DraftStatus = (typeof DRAFT_STATUSES)[number]

/** What a draft rests on: the facts it states and the confirmed career items it used. */
export type DraftBasis = { readonly facts: readonly string[]; readonly itemIds: readonly string[] }

export type AnswerDraft = {
  readonly id: string
  readonly questionKey: string
  /** Set for a draft written for one job (motivation); accepting it answers that job only. */
  readonly jobId: string | null
  readonly label: string
  readonly method: DraftMethod
  readonly status: DraftStatus
  /** Set exactly when drafted. */
  readonly answer: SavedAnswerValue | null
  readonly basis: DraftBasis
  /** Why there is no draft, in words the candidate can act on. */
  readonly reason: string | null
  readonly createdAt: Date
}
