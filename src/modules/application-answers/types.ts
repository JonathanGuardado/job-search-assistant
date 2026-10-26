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
})
export type SaveAnswer = z.infer<typeof SaveAnswerSchema>

export type SavedAnswer = {
  readonly questionKey: string
  readonly label: string
  readonly answer: SavedAnswerValue
  readonly updatedAt: Date
}
