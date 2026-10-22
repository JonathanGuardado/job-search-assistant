import { describe, expect, it } from 'vitest'
import type { CandidateProfileInput } from '@/modules/profiles'
import { eligibilityProfileOf } from './profile.js'

const modes = {
  country: 'preferred', city: 'preferred', timezone: 'preferred', workAuthorizations: 'hard', willingToRelocate: 'hard',
  allowedRegions: 'preferred', employmentTypes: 'preferred', salaryFloorMinor: 'preferred', salaryCurrency: 'preferred',
  targetRoles: 'preferred', seniority: 'preferred', preferredTech: 'preferred', excludedTech: 'preferred',
  excludedCompanies: 'preferred', excludedIndustries: 'preferred',
} as const satisfies CandidateProfileInput['constraintModes']

const input = (overrides: Partial<CandidateProfileInput> = {}): CandidateProfileInput => ({
  country: 'SV', city: 'San Salvador', timezone: 'America/El_Salvador', workAuthorizations: [], willingToRelocate: false,
  allowedRegions: ['latam', 'es'], employmentTypes: ['contractor'], salaryFloorMinor: 6_000_000, salaryCurrency: 'USD',
  targetRoles: ['Engineer'], seniority: 'senior', preferredTech: [], excludedTech: [], excludedCompanies: [], excludedIndustries: [],
  constraintModes: modes, ...overrides,
})

describe('eligibilityProfileOf', () => {
  it('rejects on location only when the allowed-regions setting is hard', () => {
    expect(eligibilityProfileOf(input()).hardConstraints.has('location')).toBe(false)
    expect(eligibilityProfileOf(input({ constraintModes: { ...modes, allowedRegions: 'hard' } })).hardConstraints.has('location')).toBe(true)
  })

  it('maps each hard setting to the constraint it governs', () => {
    const all = eligibilityProfileOf(input({ constraintModes: {
      ...modes, allowedRegions: 'hard', timezone: 'hard', employmentTypes: 'hard', salaryFloorMinor: 'hard',
    } }))
    expect([...all.hardConstraints].sort()).toEqual(['employmentType', 'location', 'salary', 'timezone'])
  })

  it('passes the selected regions and countries through for the location rule', () => {
    expect(eligibilityProfileOf(input()).allowedRegions).toEqual(['latam', 'es'])
  })
})
