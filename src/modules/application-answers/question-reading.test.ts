import { describe, expect, it } from 'vitest'
import { readingFrom, type RawReading } from './question-reading.js'

const raw = (changes: Partial<RawReading>): RawReading => ({
  id: 'q1', kind: 'needs_sponsorship', countries: [], company: null, skill: null, language: null, period: null, currency: null, withinYears: null, ...changes,
})

describe('a reading from the model\'s output', () => {
  it('keeps real country codes, normalized and once each, and drops the rest', () => {
    expect(readingFrom(raw({ countries: ['us', 'US', ' ir ', 'XX', 'Crimea', 'KP'] })).countries).toEqual(['US', 'IR', 'KP'])
  })

  it('normalizes language and currency codes and nulls malformed ones', () => {
    expect(readingFrom(raw({ kind: 'language_level', language: 'EN' })).language).toBe('en')
    expect(readingFrom(raw({ kind: 'language_level', language: 'English' })).language).toBeNull()
    expect(readingFrom(raw({ kind: 'salary_expectation', currency: 'usd' })).currency).toBe('USD')
    expect(readingFrom(raw({ kind: 'salary_expectation', currency: 'dollars' })).currency).toBeNull()
  })

  it('turns empty names into null and drops an impossible window', () => {
    expect(readingFrom(raw({ kind: 'worked_at', company: '  ' })).company).toBeNull()
    expect(readingFrom(raw({ kind: 'worked_at', company: ' GitLab ' })).company).toBe('GitLab')
    expect(readingFrom(raw({ kind: 'recent_graduate', withinYears: 2.5 })).withinYears).toBeNull()
    expect(readingFrom(raw({ kind: 'recent_graduate', withinYears: 2 })).withinYears).toBe(2)
  })
})
