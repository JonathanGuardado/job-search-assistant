/**
 * Public surface of the automation module: filling a job's application form in a visible
 * browser that the owner submits, and the record of each attempt (decision 0016). Model-free.
 * Other modules import from here and nowhere deeper (docs/architecture.md).
 */

// Exported for foreign keys only. Only this module writes it.
export { applicationFills } from './schema.js'

export {
  cancelFill, claimFill, endAttempt, expireFills, finishPending, finishRecording, LEASE_MS, markFilling, markStale, prepareFill, PREPARED_TTL_MS,
  QUEUED_TTL_MS, recordReport, recordSubmission, renewLease, settleFill, startFill,
} from './service.js'
export type { Fill } from './service.js'
export { openVisibleBrowser } from './browser.js'
export { applicationFillQueue, queueFill } from './queues.js'
export { runFill } from './runner.js'
export type { BrowserSession, RunnerDeps, RunOutcome } from './runner.js'
export { FILL_OUTCOMES, FILL_STATUSES } from './types.js'
export type { CapturedSubmission, FieldResult, FillOutcome, FillReport, FillStatus, OutcomeEvidence } from './types.js'
