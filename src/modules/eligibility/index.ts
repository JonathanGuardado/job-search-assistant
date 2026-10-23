/**
 * Public surface of the eligibility module. Other modules import from here and
 * nowhere deeper — see docs/architecture.md, module contract.
 */

export {
  assessEligibility,
  claimsFromStructuredFields,
  evaluateRules,
  postingText,
  validateQuotes,
  stageFor,
  MIN_CONFIDENCE,
} from './engine.js'
export { eligibilityProfileOf } from './profile.js'
export { eligibilityAssessments, jobEligibilityClaims } from './schema.js'
export { assessJobForUser, effectiveVerdict, enqueueAssessmentsForJob, enqueueAssessmentsForUser, getAssessment, listJobIdsNotRejected } from './service.js'
export type { Assessment, AssessmentOutcome } from './service.js'
export { assessEligibilityQueue, enqueueReassessUser, reassessUserQueue } from './queues.js'
export { extractClaimsTask } from './prompts/extract-claims.js'
export { extractClaimsWithModel } from './extract.js'
export type { ExtractClaims } from './extract.js'

export { RULES } from './rules.js'
/** The country table the location rule uses; the settings page offers exactly these. */
export { REGION_COUNTRIES } from './regions.js'

export {
  EligibilityClaimsSchema,
  UNSPECIFIED_CLAIMS,
  ENGINE_VERSION,
  RULE_IDS,
  HARD_CONSTRAINT_KEYS,
  ALWAYS_HARD,
} from './types.js'

export type {
  AssessmentStage,
  EligibilityClaims,
  EligibilityJob,
  EligibilityProfile,
  EligibilityVerdict,
  Evidence,
  HardConstraintKey,
  Region,
  Rule,
  RuleId,
  RuleInput,
  RuleOutcome,
} from './types.js'
