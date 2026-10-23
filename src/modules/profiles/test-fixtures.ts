import { CandidateProfileInputSchema, ConstraintModesSchema } from './types.js'

export const profileFixture = CandidateProfileInputSchema.parse({
  country: 'SV', city: 'Synthetic City', timezone: 'America/El_Salvador',
  workAuthorizations: [{ country: 'SV', type: 'citizen' }, { country: 'MX', type: 'permit', expiresAt: '2027-12-31' }],
  willingToRelocate: false, allowedRegions: ['latam', 'worldwide'], employmentTypes: ['employee', 'contractor'],
  salaryFloorMinor: 12345, salaryCurrency: 'USD', targetRoles: ['Backend Engineer'], seniority: 'Senior',
  preferredTech: ['TypeScript'], excludedTech: ['COBOL'], excludedCompanies: ['Synthetic Company'], excludedIndustries: [], spokenLanguages: ['es', 'en'],
  constraintModes: ConstraintModesSchema.parse(Object.fromEntries(Object.keys(ConstraintModesSchema.shape).map((key) => [key, 'hard']))),
})
