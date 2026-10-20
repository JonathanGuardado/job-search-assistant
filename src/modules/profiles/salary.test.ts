import { describe, expect, it } from 'vitest'
import { salaryFromInput, salaryToInput } from './salary.js'

describe('salary minor units', () => {
  it.each([['123.45', 'USD', 12345], ['0.29', 'USD', 29], ['8000000', 'JPY', 8000000], ['1.234', 'KWD', 1234], ['0', 'USD', 0]])(
    'converts %s %s exactly', (amount, currency, minor) => {
      expect(salaryFromInput(amount, currency)).toEqual({ ok: true, value: minor })
      expect(salaryFromInput(salaryToInput(minor, currency), currency)).toEqual({ ok: true, value: minor })
    },
  )
  it('keeps an unstated floor null', () => {
    expect(salaryFromInput('', 'USD')).toEqual({ ok: true, value: null })
    expect(salaryToInput(null, 'USD')).toBe('')
  })
  it.each([['1.001', 'USD'], ['1.1', 'JPY'], ['-1', 'USD'], ['1e3', 'USD'], ['1,000', 'USD'], ['21474836.48', 'USD'], ['10', 'ZZZ']])(
    'rejects unsupported or unrepresentable salary %s %s', (amount, currency) => {
      expect(salaryFromInput(amount, currency).ok).toBe(false)
    },
  )
  it('accepts the maximum representable integer without rounding', () => {
    expect(salaryFromInput('21474836.47', 'USD')).toEqual({ ok: true, value: 2147483647 })
  })
})
