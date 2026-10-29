/**
 * Public surface of the automation module: filling a job's application form in a visible
 * browser that the owner submits, and the record of each attempt (decision 0016). Model-free.
 * Other modules import from here and nowhere deeper (docs/architecture.md).
 */

// Exported for foreign keys only. Only this module writes it.
export { applicationFills } from './schema.js'

export { FILL_OUTCOMES, FILL_STATUSES } from './types.js'
export type { CapturedSubmission, FieldResult, FillOutcome, FillReport, FillStatus, OutcomeEvidence } from './types.js'
