import { createHash } from 'node:crypto'
import type { LocationPolicy, Seniority } from './types.js'
import { foldText, wordsOf } from './text.js'

/** A location string as an order-independent key: "B; A" and "a;b" match, "Chile" and "Texas" do not. */
export function locationKey(locationText: string | null): string {
  if (locationText === null) return ''
  const parts = locationText.split(';').map((part) => (foldText(part).match(/[\p{L}\p{N}]+/gu) ?? []).join(' '))
  return [...new Set(parts.filter(Boolean))].sort().join(';')
}

export type FingerprintInput = {
  readonly companyNormalized: string
  readonly titleNormalized: string
  /** Part of the identity: a Senior and a Principal opening with one title are different jobs. */
  readonly seniority: Seniority | null
  readonly locationPolicy: LocationPolicy
  readonly locationKey: string
  readonly description: string
}

// Requisition and posting numbers (MongoDB embeds two per posting). Short numbers like
// "5+ years" or "8am" are content and stay.
const IDENTIFIER = /^\d{5,}$/

/**
 * Two postings with the same fingerprint are the same posting (decision 0008). The
 * description is part of it, compared exactly once case, punctuation, whitespace and
 * identifiers are ignored: in real data, near-identical postings differ in exactly the
 * details eligibility depends on (working hours, schedule, years), so no similarity
 * threshold is safe.
 */
export function fingerprint(input: FingerprintInput): string {
  const description = wordsOf(input.description).filter((word) => !IDENTIFIER.test(word)).join(' ')
  // JSON array encoding, so no text can move from one component into another.
  const key = JSON.stringify([
    input.companyNormalized, input.titleNormalized, input.seniority, input.locationPolicy, input.locationKey, description,
  ])
  return createHash('sha256').update(key).digest('hex')
}
