import { describe, expect, it } from 'vitest'
import { experienceMonths, yearsLabel } from './experience.js'

const today = new Date('2026-10-15T00:00:00Z')
const role = (startedOn: string | null, endedOn: string | null, isCurrent = false) => ({ startedOn, endedOn, isCurrent })

describe('experienceMonths: the least the dates can mean', () => {
  it('counts the months between a start and an end month', () => {
    expect(experienceMonths([role('2020-03', '2020-06')], today)).toBe(3)
    expect(experienceMonths([role('2021-12', '2023-10')], today)).toBe(22)
  })

  it('counts overlapping roles once', () => {
    // Agency contract (FullStack Labs) spanning client roles that are listed separately.
    expect(experienceMonths([role('2021-12', '2026-01'), role('2021-12', '2023-10'), role('2023-11', '2025-07')], today)).toBe(49)
  })

  it('adds roles separated by a gap without counting the gap', () => {
    expect(experienceMonths([role('2018-01', '2019-01'), role('2020-01', '2021-01')], today)).toBe(24)
  })

  it('reads a year alone as late in its year for a start and early for an end', () => {
    expect(experienceMonths([role('2019', '2021')], today)).toBe(13)
    expect(experienceMonths([role('2020', '2020')], today)).toBe(0)
  })

  it('runs a current role to today', () => {
    expect(experienceMonths([role('2026-01', null, true)], today)).toBe(9)
  })

  it('cannot count a role without a start, or one that ended on an unknown date', () => {
    expect(experienceMonths([role(null, '2020-01'), role('2019-01', null)], today)).toBeNull()
    expect(experienceMonths([], today)).toBeNull()
    expect(experienceMonths([role(null, '2020-01'), role('2020-01', '2020-07')], today)).toBe(6)
  })
})

describe('yearsLabel', () => {
  it.each([[0, 'less than a month'], [7, '7 months'], [12, '1 year'], [49, '4 years'], [143, '11 years']])('%i months → %s', (months, label) => {
    expect(yearsLabel(months)).toBe(label)
  })
})
