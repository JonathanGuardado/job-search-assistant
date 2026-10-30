import { describe, expect, it } from 'vitest'
import { annualSalary } from './salary.js'

describe('annual salary conversion', () => {
  it.each([
    { min: 85000, max: 175000, currency: 'USD', minMinor: 8500000, maxMinor: 17500000 },
    { min: null, max: 100, currency: 'USD', minMinor: null, maxMinor: 10000 },
    { min: 100, max: undefined, currency: 'USD', minMinor: 10000, maxMinor: null },
    { min: 0, max: 0, currency: 'USD', minMinor: 0, maxMinor: 0 },
    { min: 5000000, max: null, currency: 'JPY', minMinor: 5000000, maxMinor: null },
    { min: 1.234, max: null, currency: 'KWD', minMinor: 1234, maxMinor: null },
    { min: 1.235, max: null, currency: 'USD', minMinor: 124, maxMinor: null },
  ])('converts $currency bounds $min and $max into minor units', ({ min, max, currency, minMinor, maxMinor }) => {
    expect(annualSalary(min, max, currency)).toEqual({ source: 'posted', minMinor, maxMinor, currency })
  })

  it.each([
    { min: undefined, max: null, currency: 'USD' },
    { min: 200, max: 100, currency: 'USD' },
    { min: '85000', max: 100000, currency: 'USD' },
    { min: 85000, max: '100000', currency: 'USD' },
    { min: true, max: null, currency: 'USD' },
    { min: {}, max: null, currency: 'USD' },
    { min: -1, max: null, currency: 'USD' },
    { min: null, max: -1, currency: 'USD' },
    { min: NaN, max: null, currency: 'USD' },
    { min: 0, max: Infinity, currency: 'USD' },
    { min: Number.MAX_SAFE_INTEGER, max: null, currency: 'USD' },
    { min: null, max: Number.MAX_VALUE, currency: 'USD' },
    { min: 100, max: null, currency: 'usd' },
    { min: 100, max: null, currency: 'US' },
    { min: 100, max: null, currency: null },
    { min: 100, max: null, currency: undefined },
    { min: 100, max: null, currency: 123 },
  ])('keeps unusable or ambiguous bounds unknown: %j', ({ min, max, currency }) => {
    expect(annualSalary(min, max, currency)).toEqual({ source: 'unknown' })
  })
})
