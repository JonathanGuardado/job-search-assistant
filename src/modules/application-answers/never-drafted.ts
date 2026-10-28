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
/** What no record holds: school results, contact preferences, obligations to employers, the owner's own equipment. */
const NO_RECORD = [
  /\bhigh school\b|\bsecondary school\b|\bGPA\b|\bgrade point\b|\bdegree result\b/i,
  /\bhow (should|can|may|do) we (communicate|contact|reach)\b|\bpreferred (method|way|means) of (contact|communication)\b/i,
  /\bnon-?compete\b|\bpost-employment restrictions?\b|\brestrictive covenants?\b|\bemployment agreements?\b/i,
  /\b(your|my) own (computer|device|laptop|machine|equipment|hardware)\b/i,
]

export function neverDrafted(question: FormQuestion): NeverDrafted | null {
  if (question.section === 'demographic' || question.section === 'compliance') return 'demographic'
  const text = `${question.label} ${question.description ?? ''}`
  if (CONSENT.some((pattern) => pattern.test(text))) return 'consent'
  if (DEMOGRAPHIC.test(text)) return 'demographic'
  if (NO_RECORD.some((pattern) => pattern.test(text))) return 'no_record'
  return null
}

/** The employer asks for the candidate's own words, or forbids AI-written answers. */
const OWN_WORDS = [
  /\bown words\b/i,
  /\b(AI|artificial intelligence)[- ]generated\b/i,
  /\bgenerated content\b/i,
  /\b(use of|using|do not use|don't use|without)\b[^.?!]{0,40}\b(AI|ChatGPT|artificial intelligence)\b/i,
]

/**
 * A form question saying answers must be the candidate's own words. On such a form no answer
 * is written by a model (decision 0014): the owner would be attesting to something untrue.
 */
export function asksOwnWords(question: FormQuestion): boolean {
  const text = `${question.label} ${question.description ?? ''}`
  return OWN_WORDS.some((pattern) => pattern.test(text))
}
