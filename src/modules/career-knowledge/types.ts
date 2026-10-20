import { z } from 'zod'

export const CAREER_ITEM_TYPES = ['role', 'project', 'education', 'achievement', 'story'] as const
export const CareerItemTypeSchema = z.enum(CAREER_ITEM_TYPES)
export type CareerItemType = z.infer<typeof CareerItemTypeSchema>

/**
 * `YYYY` or `YYYY-MM`. A resume that says "2020" yields "2020", never
 * "2020-01": storing a month the source does not state would invent a fact.
 */
export const PARTIAL_DATE_PATTERN = '^\\d{4}(-(0[1-9]|1[0-2]))?$'
export const PartialDateSchema = z
  .string()
  .regex(new RegExp(PARTIAL_DATE_PATTERN), 'Dates are a year or a year and month, like 2020 or 2020-03.')
export type PartialDate = z.infer<typeof PartialDateSchema>

/** Where in the resume's extracted text a value was found. Offsets index the original text. */
export const SpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: z.string(),
})
export type EvidenceSpan = z.infer<typeof SpanSchema>

/** Parse-time provenance. User edits do not rewrite it; it records what the resume said. */
export const EvidenceSchema = z.object({
  organization: SpanSchema.optional(),
  title: SpanSchema.optional(),
  startedOn: SpanSchema.optional(),
  endedOn: SpanSchema.optional(),
  isCurrent: SpanSchema.optional(),
  summary: SpanSchema.optional(),
  achievements: z.array(SpanSchema),
  technologies: z.array(SpanSchema),
})
export type Evidence = z.infer<typeof EvidenceSchema>

// ---------------------------------------------------------------------------
// What the model returns. Every text value must be copied from the resume; the
// sanitizer keeps only values it can find there and stores the source's own text.

const DatedQuoteSchema = z.object({
  value: PartialDateSchema,
  /** The date exactly as written, e.g. "Mar 2020" or "03/2020". */
  quote: z.string(),
})

export const ExtractedItemSchema = z.object({
  type: CareerItemTypeSchema,
  organization: z.string().nullable(),
  title: z.string().nullable(),
  startedOn: DatedQuoteSchema.nullable(),
  endedOn: DatedQuoteSchema.nullable(),
  /** Set only when the resume marks the entry as ongoing ("Present", "Actualidad"). */
  current: z.object({ quote: z.string() }).nullable(),
  summary: z.string().nullable(),
  achievements: z.array(z.string()),
  technologies: z.array(z.string()),
})
export type ExtractedItem = z.infer<typeof ExtractedItemSchema>

export const ExtractedResumeSchema = z.object({ items: z.array(ExtractedItemSchema) })
export type ExtractedResume = z.infer<typeof ExtractedResumeSchema>

// ---------------------------------------------------------------------------
// After sanitizing: only values found verbatim in the source survive.

export const CareerItemDraftSchema = z.object({
  type: CareerItemTypeSchema,
  organization: z.string().nullable(),
  title: z.string().nullable(),
  startedOn: PartialDateSchema.nullable(),
  endedOn: PartialDateSchema.nullable(),
  isCurrent: z.boolean(),
  summary: z.string().nullable(),
  achievements: z.array(z.string()),
  technologies: z.array(z.string()),
  evidence: EvidenceSchema,
})
export type CareerItemDraft = z.infer<typeof CareerItemDraftSchema>

export const REJECTION_REASONS = [
  'not_in_source', // the quoted text does not appear in the resume
  'month_not_in_quote', // the month was dropped; the year was kept
  'date_not_in_quote', // the date's quote does not state that year
  'not_marked_current', // "current" was claimed without a present-tense marker
  'conflicts_with_current', // an end date on an entry the resume marks as ongoing
  'empty_item', // nothing about the entry survived verification
] as const

export const RejectedValueSchema = z.object({
  itemIndex: z.number().int().nonnegative(),
  field: z.string(),
  value: z.string(),
  reason: z.enum(REJECTION_REASONS),
})
export type RejectedValue = z.infer<typeof RejectedValueSchema>

// ---------------------------------------------------------------------------
// Stored items and user edits.

const CareerItemFieldsSchema = z.object({
  type: CareerItemTypeSchema,
  organization: z.string().trim().min(1).nullable(),
  title: z.string().trim().min(1).nullable(),
  startedOn: PartialDateSchema.nullable(),
  endedOn: PartialDateSchema.nullable(),
  isCurrent: z.boolean(),
  summary: z.string().trim().min(1).nullable(),
  achievements: z.array(z.string().trim().min(1)),
  technologies: z.array(z.string().trim().min(1)),
})

/** Orders partial dates by their shared precision: "2020" is not after "2020-05". */
function isOrdered(from: PartialDate, to: PartialDate): boolean {
  const width = Math.min(from.length, to.length)
  return from.slice(0, width) <= to.slice(0, width)
}

/** A user's correction. Shared by the review form and the service. */
export const CareerItemEditSchema = CareerItemFieldsSchema.refine(
  (item) => !(item.isCurrent && item.endedOn !== null),
  { message: 'An ongoing entry has no end date.', path: ['endedOn'] },
).refine(
  (item) => item.startedOn === null || item.endedOn === null || isOrdered(item.startedOn, item.endedOn),
  { message: 'The end date is before the start date.', path: ['endedOn'] },
)
export type CareerItemEdit = z.infer<typeof CareerItemEditSchema>

const StoredFieldsSchema = CareerItemFieldsSchema.extend({
  id: z.uuid(),
  userId: z.uuid(),
  evidence: EvidenceSchema,
  sourceResumeId: z.uuid().nullable(),
  sourceParseId: z.uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const UnverifiedCareerItemSchema = StoredFieldsSchema.extend({
  verifiedByUser: z.literal(false),
  verifiedAt: z.null(),
})

/**
 * The only shape generated text may be grounded in (CLAUDE.md rule 1). Phase 2
 * code that accepts this type cannot be handed an unconfirmed parse result.
 */
export const VerifiedCareerItemSchema = StoredFieldsSchema.extend({
  verifiedByUser: z.literal(true),
  verifiedAt: z.date(),
})

export const CareerItemSchema = z.discriminatedUnion('verifiedByUser', [
  UnverifiedCareerItemSchema,
  VerifiedCareerItemSchema,
])
export type UnverifiedCareerItem = z.infer<typeof UnverifiedCareerItemSchema>
export type VerifiedCareerItem = z.infer<typeof VerifiedCareerItemSchema>
export type CareerItem = z.infer<typeof CareerItemSchema>

/** Queue payload for parsing one resume version into draft items. */
export const ResumeParsePayloadSchema = z.object({
  userId: z.uuid(),
  resumeId: z.uuid(),
})
export type ResumeParsePayload = z.infer<typeof ResumeParsePayloadSchema>
