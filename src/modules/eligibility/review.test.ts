import { describe, expect, it } from 'vitest'
import { reviewGroup } from './service.js'
import type { AssessmentReasons, Verdict } from './types.js'

const assessment = (verdict: Verdict, reasons: AssessmentReasons = {}, userOverride: Verdict | null = null) => ({ verdict, userOverride, reasons })

describe('reviewGroup: the tab a job belongs in', () => {
  it.each([
    ['an eligible job', assessment('eligible'), 'can_apply'],
    ['a rejected job', assessment('not_eligible', { ruleId: 'remote-scope-excludes-country', reason: 'x' }), 'not_eligible'],
    ['a posting that names only a place', assessment('needs_review', { openQuestions: ['q'], isLocationOnly: true, unresolvedRules: ['onsite-requires-relocation'] }), 'location_only'],
    ['a review waiting only on visa sponsorship', assessment('needs_review', { openQuestions: ['q'], isLocationOnly: false, unresolvedRules: ['authorization-missing'] }), 'visa_unknown'],
    ['any other review', assessment('needs_review', { openQuestions: ['q'], isLocationOnly: false, unresolvedRules: ['timezone-overlap-impossible'] }), 'needs_review'],
    ['a review from before engine v4', assessment('needs_review', { openQuestions: ['q'] }), 'needs_review'],
  ] as const)('%s → %s', (_label, a, group) => {
    expect(reviewGroup(a)).toBe(group)
  })

  it('follows the user\'s override over the engine', () => {
    expect(reviewGroup(assessment('not_eligible', { ruleId: 'remote-scope-excludes-country', reason: 'x' }, 'eligible'))).toBe('can_apply')
    expect(reviewGroup(assessment('needs_review', { openQuestions: ['q'], unresolvedRules: ['authorization-missing'] }, 'needs_review'))).toBe('needs_review')
    expect(reviewGroup(assessment('eligible', {}, 'not_eligible'))).toBe('not_eligible')
  })
})
