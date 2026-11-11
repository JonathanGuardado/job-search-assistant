import { describe, expect, it } from 'vitest'
import { companyMark, formatLocation, formatPosted, formatSalary } from './format'

describe('formatSalary', () => {
  it('formats USD bounds in major units with an en dash', () => {
    expect(formatSalary({ source: 'posted', minMinor: 14_300_000, maxMinor: 19_000_000, currency: 'USD' })).toBe('$143,000–$190,000')
  })

  it('formats a minimum only', () => {
    expect(formatSalary({ source: 'posted', minMinor: 14_300_000, maxMinor: null, currency: 'USD' })).toBe('From $143,000')
  })

  it('formats a maximum only', () => {
    expect(formatSalary({ source: 'posted', minMinor: null, maxMinor: 19_000_000, currency: 'USD' })).toBe('Up to $190,000')
  })

  it('leaves an unknown salary unstated', () => {
    expect(formatSalary({ source: 'unknown' })).toBeNull()
  })

  it('uses zero minor digits for JPY', () => {
    expect(formatSalary({ source: 'posted', minMinor: 5_000_000, maxMinor: null, currency: 'JPY' })).toBe('From ¥5,000,000')
  })

  it('uses all three minor digits for KWD and preserves a posted zero', () => {
    expect(formatSalary({ source: 'posted', minMinor: 1_234_000, maxMinor: null, currency: 'KWD' })).toBe('From KWD 1,234')
    expect(formatSalary({ source: 'posted', minMinor: 0, maxMinor: null, currency: 'USD' })).toBe('From $0')
  })
})

describe('formatLocation', () => {
  it('shows the stored location and a fallback only when absent', () => {
    expect(formatLocation('Remote, LATAM')).toBe('Remote, LATAM')
    expect(formatLocation(null)).toBe('Location not stated')
  })
})

describe('formatPosted', () => {
  const now = new Date('2026-11-10T12:00:00Z')

  it('says today, then days, months and years', () => {
    expect(formatPosted(new Date('2026-11-10T01:00:00Z'), now)).toBe('Posted today')
    expect(formatPosted(new Date('2026-11-09T10:00:00Z'), now)).toBe('Posted yesterday')
    expect(formatPosted(new Date('2026-11-07T12:00:00Z'), now)).toBe('Posted 3 days ago')
    expect(formatPosted(new Date('2026-09-01T12:00:00Z'), now)).toBe('Posted 2 months ago')
    expect(formatPosted(new Date('2024-11-01T12:00:00Z'), now)).toBe('Posted 2 years ago')
  })

  it('treats a date in the future as today and a missing one as unstated', () => {
    expect(formatPosted(new Date('2026-11-12T12:00:00Z'), now)).toBe('Posted today')
    expect(formatPosted(null, now)).toBeNull()
  })
})

describe('companyMark', () => {
  it('keeps one letter and color per company name', () => {
    expect(companyMark('toptal')).toEqual(companyMark('toptal'))
    expect(companyMark('toptal').letter).toBe('T')
    expect(companyMark('  ').letter).toBe('?')
  })
})
