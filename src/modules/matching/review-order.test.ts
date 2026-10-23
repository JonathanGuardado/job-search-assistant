import { describe, expect, it } from 'vitest'
import { compareForReview, summarizeMatch } from './review-order.js'
import type { Dimension, DimensionStatus, Finding } from './types.js'

const finding = (status: Finding['status']): Finding => ({ requirement: 'X', importance: 'required', quote: null, status, note: null, evidence: [] })
const dimension = (status: DimensionStatus, findings: Finding[] = []): Dimension => ({ status, findings })
const none = dimension('not_stated')

const match = (role: DimensionStatus, required: Finding['status'][], concerns: string[] = []) => ({
  dimensions: {
    requiredSkills: required.length ? dimension('partial', required.map(finding)) : none, preferredSkills: none, experience: none, languages: none,
    role: dimension(role), seniority: none, salary: none, employmentType: none, preferences: none,
  },
  concerns,
  salaryCompatibility: 'unknown' as const,
})

describe('compareForReview: the order the jobs view shows, and says it shows', () => {
  it('puts the target role first, then more required skills shown, then fewer concerns, then unmatched jobs', () => {
    const exact = match('meets', ['met', 'missing'])
    const exactBetter = match('meets', ['met', 'met'])
    const exactQuiet = match('meets', ['met', 'met'], [])
    const exactNoisy = match('meets', ['met', 'met'], ['a', 'b'])
    const close = match('partial', ['met', 'met'])
    const other = match('gap', ['met', 'met'])
    const sorted = [other, null, close, exactNoisy, exact, exactQuiet, exactBetter].sort(compareForReview)
    expect(sorted).toEqual([exactBetter, exactQuiet, exactNoisy, exact, close, other, null])
  })
})

describe('summarizeMatch: what a list row shows', () => {
  it('counts required skills shown, and leads with the worst concern', () => {
    expect(summarizeMatch(match('partial', ['met', 'short', 'missing'], ['Missing required: Go.', 'Staff role; you target senior.']))).toEqual({
      requiredShown: 1, requiredTotal: 3, roleStatus: 'partial', topConcern: 'Missing required: Go.', salaryCompatibility: 'unknown',
    })
    expect(summarizeMatch(match('meets', []))).toMatchObject({ requiredShown: 0, requiredTotal: 0, topConcern: null })
  })
})
