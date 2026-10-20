/**
 * Public surface of the career-knowledge module: the candidate's structured
 * record and the extraction task that proposes it from a resume.
 *
 * Grounding rule: generated text may use listGroundingItems() only. It returns
 * VerifiedCareerItem, which a draft can never satisfy.
 */

export {
  confirmCareerItem,
  discardDraft,
  prepareCareerItemsForResumeDeletion,
  listCareerItems,
  listGroundingItems,
  recordDrafts,
  saveCareerItem,
} from './service.js'
export { getParseReport, runResumeParse } from './parse-resume.js'
export type { ExtractCareerItems, ParseReport } from './parse-resume.js'
export { resumeParseKey, resumeParseQueue } from './queues.js'

export {
  CAREER_ITEM_TYPES,
  CareerItemEditSchema,
  CareerItemSchema,
  PartialDateSchema,
  ResumeParsePayloadSchema,
  VerifiedCareerItemSchema,
} from './types.js'
export type {
  CareerItem,
  CareerItemDraft,
  CareerItemEdit,
  CareerItemType,
  Evidence,
  EvidenceSpan,
  RejectedValue,
  ResumeParsePayload,
  UnverifiedCareerItem,
  VerifiedCareerItem,
} from './types.js'
