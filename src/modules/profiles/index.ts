/**
 * Public surface of the profiles module.
 *
 * `users` is exported so other modules' schemas can declare foreign keys to it.
 * Only this module writes to it.
 */
export { users } from './schema.js'
export { ensureUser } from './service.js'
export { NewUserSchema, UserSchema } from './types.js'
export type { NewUser, User } from './types.js'
export { getCandidateProfile, saveCandidateProfile } from './service.js'
export { CandidateProfileFormSchema, profileFormInput } from './form.js'
export { CURRENCIES, salaryToInput } from './salary.js'
export { CandidateProfileInputSchema, CandidateProfileSchema, ConstraintModesSchema, EMPLOYMENT_TYPES } from './types.js'
export type { CandidateProfile, CandidateProfileInput, ConstraintField, ConstraintModes, WorkAuthorization } from './types.js'
