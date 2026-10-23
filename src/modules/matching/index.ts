/**
 * Public surface of the matching module. Other modules import from here and nowhere
 * deeper (docs/architecture.md). The model reads a posting's requirements; code compares
 * them with the candidate's record and explains the result (decision 0010).
 */

export { jobRequirements, matchAssessments } from './schema.js'
export { assessMatchForUser, enqueueMatch, enqueueMatchesForUser, getMatch, getMatchCard, inputsHashOf } from './service.js'
export type { Match, MatchOutcome } from './service.js'
export { assessMatchQueue, enqueueRematchUser, matchKey, rematchUserQueue } from './queues.js'
export { extractRequirementsTask } from './prompts/extract-requirements.js'
export { extractRequirementsWithModel, postingText, validateRequirements } from './extract.js'
export type { ExtractRequirements } from './extract.js'
export { compareRequirements } from './compare.js'
export type { MatchCandidate, MatchCareerItem, MatchJob } from './compare.js'
export { explainMatch } from './explain.js'
export type { CardSection } from './explain.js'
export { skillKey } from './skills.js'

export {
  DIMENSION_KEYS,
  JobRequirementsSchema,
  MATCH_ENGINE_VERSION,
  NO_REQUIREMENTS,
} from './types.js'
export type {
  CandidateEvidence,
  Dimension,
  DimensionKey,
  DimensionStatus,
  Dimensions,
  Finding,
  JobRequirements,
  MatchResult,
  SalaryCompatibility,
} from './types.js'
