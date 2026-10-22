import type { CandidateProfileInput } from '@/modules/profiles'
import type { EligibilityProfile, HardConstraintKey } from './types.js'

/**
 * The rules' view of a candidate. Which constraints may reject comes from the
 * profile's own hard/preferred settings (D8): nothing about location is hardcoded.
 * Authorization and relocation are always hard (ALWAYS_HARD).
 */
export function eligibilityProfileOf(profile: CandidateProfileInput): EligibilityProfile {
  const modes = profile.constraintModes
  const hardConstraints = new Set<HardConstraintKey>()
  if (modes.allowedRegions === 'hard') hardConstraints.add('location')
  if (modes.timezone === 'hard') hardConstraints.add('timezone')
  if (modes.employmentTypes === 'hard') hardConstraints.add('employmentType')
  if (modes.salaryFloorMinor === 'hard') hardConstraints.add('salary')
  return {
    country: profile.country,
    timezone: profile.timezone,
    workAuthorizations: profile.workAuthorizations.map(({ country, type }) => ({ country, type })),
    willingToRelocate: profile.willingToRelocate,
    allowedRegions: profile.allowedRegions,
    employmentTypes: profile.employmentTypes,
    salaryFloorMinor: profile.salaryFloorMinor,
    salaryCurrency: profile.salaryCurrency,
    hardConstraints,
  }
}
