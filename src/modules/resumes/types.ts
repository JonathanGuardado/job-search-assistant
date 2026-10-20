import { z } from 'zod'
import { ModelTraceSchema } from '@/modules/ai'

export const RESUME_CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const
export const ResumeContentTypeSchema = z.enum(RESUME_CONTENT_TYPES)
export type ResumeContentType = z.infer<typeof ResumeContentTypeSchema>

export const MAX_RESUME_BYTES = 5 * 1024 * 1024

/** An uploaded version. Immutable: the database refuses UPDATE for the app role. */
export const ResumeSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  version: z.number().int().positive(),
  parentId: z.uuid().nullable(),
  isMaster: z.boolean(),
  filename: z.string().min(1),
  contentType: ResumeContentTypeSchema,
  byteSize: z.number().int().positive(),
  contentSha256: z.string().length(64),
  storageKey: z.string().min(1),
  textExtractor: z.string().min(1),
  createdAt: z.date(),
})
export type Resume = z.infer<typeof ResumeSchema>

export const ResumeWithTextSchema = ResumeSchema.extend({ extractedText: z.string() })
export type ResumeWithText = z.infer<typeof ResumeWithTextSchema>

export const UploadResumeSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  bytes: z.instanceof(Uint8Array),
})
export type UploadResume = z.infer<typeof UploadResumeSchema>

export const PARSE_STATUSES = ['running', 'succeeded', 'failed'] as const
export const ParseStatusSchema = z.enum(PARSE_STATUSES)
export type ParseStatus = z.infer<typeof ParseStatusSchema>

/**
 * One run of a parse task over one resume version. The result's shape belongs
 * to the task that produced it (career-knowledge), so it is opaque here.
 */
export const ResumeParseSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  resumeId: z.uuid(),
  task: z.string(),
  taskVersion: z.number().int().positive(),
  status: ParseStatusSchema,
  result: z.unknown(),
  traces: z.array(ModelTraceSchema),
  model: z.string().nullable(),
  costMicroUsd: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.date(),
  completedAt: z.date().nullable(),
})
export type ResumeParse = z.infer<typeof ResumeParseSchema>

/** A version plus the state of its most recent parse; `null` means none has started yet. */
export type ResumeSummary = Resume & {
  readonly latestParse: Pick<ResumeParse, 'id' | 'status' | 'errorMessage' | 'completedAt'> | null
}
