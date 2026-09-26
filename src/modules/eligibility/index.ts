/**
 * Public surface of the eligibility module. Other modules import from here and
 * nowhere deeper — see docs/architecture.md, module contract.
 */

export {
  assessEligibility,
  claimsFromStructuredFields,
  evaluateRules,
  validateQuotes,
  stageFor,
  MIN_CONFIDENCE,
} from './engine.js'

export { RULES } from './rules.js'

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
