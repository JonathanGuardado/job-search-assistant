import { describe, expect, it } from 'vitest'
import { CandidateProfileFormSchema, profileFormInput } from './form.js'
import { profileFixture } from './test-fixtures.js'
import { CandidateProfileInputSchema, ConstraintModesSchema } from './types.js'

function formFixture() {
  const form = new FormData()
  for (const [key, value] of Object.entries(profileFixture)) {
    if (typeof value === 'string') form.set(key, value)
    else if (Array.isArray(value) && !['workAuthorizations', 'employmentTypes', 'allowedRegions'].includes(key)) form.set(key, value.join(', '))
  }
  // Allowed regions are checkboxes: one form value per selected region or country.
  for (const region of profileFixture.allowedRegions) form.append('allowedRegions', region)
  form.set('salaryFloor', '123.45')
  for (const kind of profileFixture.employmentTypes) form.append('employmentTypes', kind)
  for (const authorization of profileFixture.workAuthorizations) {
    form.append('authorizationCountry', authorization.country)
    form.append('authorizationType', authorization.type)
    form.append('authorizationExpiresAt', authorization.expiresAt ?? '')
  }
  for (const [key, mode] of Object.entries(profileFixture.constraintModes)) form.set(`mode.${key}`, mode)
  return form
}

describe('profile form validation', () => {
  it('parses exactly the same complete form at either boundary', () => {
    expect(CandidateProfileFormSchema.parse(profileFormInput(formFixture()))).toEqual(profileFixture)
  })
  it.each(['workAuthorizations', 'willingToRelocate'])('rejects downgrading %s in both form and domain schemas', (key) => {
    const form = formFixture()
    form.set(`mode.${key}`, 'preferred')
    expect(CandidateProfileFormSchema.safeParse(profileFormInput(form)).success).toBe(false)
    expect(CandidateProfileInputSchema.safeParse({ ...profileFixture, constraintModes: { ...profileFixture.constraintModes, [key]: 'preferred' } }).success).toBe(false)
  })
  it('accepts preferred for every other constraint independently', () => {
    const form = formFixture()
    for (const key of Object.keys(ConstraintModesSchema.shape)) {
      if (key !== 'workAuthorizations' && key !== 'willingToRelocate') form.set(`mode.${key}`, 'preferred')
    }
    const parsed = CandidateProfileFormSchema.parse(profileFormInput(form))
    expect(Object.values(parsed.constraintModes).filter((mode) => mode === 'preferred')).toHaveLength(13)
  })
  it('normalizes country codes and allows an empty authorization list and salary floor', () => {
    const form = formFixture()
    form.set('country', 'sv')
    form.delete('allowedRegions')
    for (const value of ['LATAM', 'US', 'latam']) form.append('allowedRegions', value)
    for (const name of ['authorizationCountry', 'authorizationType', 'authorizationExpiresAt']) form.delete(name)
    form.set('salaryFloor', '')
    const parsed = CandidateProfileFormSchema.parse(profileFormInput(form))
    expect(parsed.country).toBe('SV')
    expect(parsed.allowedRegions).toEqual(['latam', 'us'])
    expect(parsed.workAuthorizations).toEqual([])
    expect(parsed.salaryFloorMinor).toBeNull()
  })
  it.each([['timezone', 'Fake/Timezone'], ['salaryCurrency', 'ZZZ'], ['salaryFloor', '1.234'], ['targetRoles', ''], ['allowedRegions', 'anywhere']])(
    'rejects invalid %s', (field, value) => {
      const form = formFixture()
      form.set(field, value)
      expect(CandidateProfileFormSchema.safeParse(profileFormInput(form)).success).toBe(false)
    },
  )
  it('rejects invalid authorization expiry and no employment arrangement', () => {
    const form = formFixture()
    form.set('authorizationExpiresAt', '2027-02-31')
    expect(CandidateProfileFormSchema.safeParse(profileFormInput(form)).success).toBe(false)
    form.delete('employmentTypes')
    expect(CandidateProfileFormSchema.safeParse(profileFormInput(form)).success).toBe(false)
  })
})
