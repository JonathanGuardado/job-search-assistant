import type { FormQuestion } from '@/modules/job-sources'

/*
 * Questions no draft is ever made for (decision 0014), found by code before any model reads
 * them, so a misreading cannot turn a consent into a drafted "yes". The patterns err toward
 * the owner: a question caught by mistake costs them one answer, never a wrong one.
 */

export type NeverDrafted = 'consent' | 'demographic' | 'no_record'

/** Agreeing, certifying or acknowledging is the owner's own act. */
const CONSENT = [/\b(I|you)\s+(agree|acknowledge|certify|consent|confirm|understand|attest)\b/i, /\bconsent\b/i, /\backnowledge\b/i, /\bprivacy (notice|policy|statement)\b/i, /\brecord and transcribe\b/i]
/** Voluntary self-identification: inferring it would be wrong. */
const DEMOGRAPHIC = /\b(gender|pronouns?|race|ethnicity|ethnic|veteran|disabilit(y|ies)|sexual orientation|transgender)\b/i
/** Results no career record holds. */
const SCHOOL_RESULTS = /\bhigh school\b|\bsecondary school\b|\bGPA\b|\bgrade point\b|\bdegree result\b/i

export function neverDrafted(question: FormQuestion): NeverDrafted | null {
  if (question.section === 'demographic' || question.section === 'compliance') return 'demographic'
  const text = `${question.label} ${question.description ?? ''}`
  if (CONSENT.some((pattern) => pattern.test(text))) return 'consent'
  if (DEMOGRAPHIC.test(text)) return 'demographic'
  if (SCHOOL_RESULTS.test(text)) return 'no_record'
  return null
}
