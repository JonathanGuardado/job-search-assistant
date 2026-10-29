/*
 * A fill: one attempt to fill a job's application form in a visible browser that the owner
 * submits (decision 0016). The reviewed packet, the captured submission and the outcome are
 * kept apart: each is its own kind of evidence.
 */

/**
 * prepared: reviewed, not started; queued → launching → filling → waiting (for the owner);
 * then submitted, uncertain (a submission cannot be ruled out), failed or abandoned (it can),
 * or stale (what the owner reviewed changed before the browser opened).
 */
export const FILL_STATUSES = ['prepared', 'queued', 'launching', 'filling', 'waiting', 'submitted', 'uncertain', 'failed', 'abandoned', 'stale'] as const
export type FillStatus = (typeof FILL_STATUSES)[number]

/** Hold the job's slot: at most one such fill per person and job, plus a submitted one not yet recorded. */
export const IN_PROGRESS: readonly FillStatus[] = ['queued', 'launching', 'filling', 'waiting', 'uncertain']

/**
 * confirmed: a success response, then the confirmation page; rejected: an error response or the
 * form's own errors; unknown: the request went out, the result is unclear; user_reported: the
 * owner says it was submitted.
 */
export const FILL_OUTCOMES = ['confirmed', 'rejected', 'unknown', 'user_reported'] as const
export type FillOutcome = (typeof FILL_OUTCOMES)[number]

/** What the filler did with one packet field, or one control the page showed that the packet did not describe. */
export type FieldResult = {
  /** null for a control the packet does not describe. */
  readonly questionKey: string | null
  readonly field: string
  readonly label: string
  readonly result: 'set' | 'not_on_page' | 'failed' | 'left_for_owner'
  readonly required: boolean
  readonly detail: string | null
}

export type FillReport = { readonly fields: readonly FieldResult[] }

/** The application request the browser sent, as captured from the network: never the reCAPTCHA token. */
export type CapturedSubmission = {
  readonly url: string
  readonly capturedAt: string
  readonly payload: unknown
  /** Uploaded before the application, by name, size and fingerprint: never the bytes. */
  readonly files: readonly { readonly name: string; readonly size: number; readonly sha256: string }[]
  readonly response: { readonly status: number } | null
}

export type OutcomeEvidence =
  | { readonly kind: 'confirmation_page'; readonly url: string; readonly text: string }
  | { readonly kind: 'error'; readonly status: number | null; readonly text: string }
  | { readonly kind: 'owner_report'; readonly at: string }
