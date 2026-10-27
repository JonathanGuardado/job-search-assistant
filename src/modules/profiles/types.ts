import { z } from 'zod'
import { CURRENCIES, MAX_SALARY_MINOR } from './salary.js'

export const NewUserSchema = z.object({
  id: z.uuid().optional(),
  email: z.email(),
})
export type NewUser = z.infer<typeof NewUserSchema>

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  createdAt: z.date(),
})
export type User = z.infer<typeof UserSchema>

export const CONSTRAINT_MODES = ['hard', 'preferred'] as const
const mode = z.enum(CONSTRAINT_MODES)
export const ConstraintModesSchema = z.object({
  country: mode,
  city: mode,
  timezone: mode,
  workAuthorizations: z.literal('hard'),
  willingToRelocate: z.literal('hard'),
  allowedRegions: mode,
  employmentTypes: mode,
  salaryFloorMinor: mode,
  salaryCurrency: mode,
  targetRoles: mode,
  seniority: mode,
  preferredTech: mode,
  excludedTech: mode,
  excludedCompanies: mode,
  excludedIndustries: mode,
})
export type ConstraintModes = z.infer<typeof ConstraintModesSchema>
export type ConstraintField = keyof ConstraintModes

const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use a two-letter country code.')
export const WorkAuthorizationSchema = z.object({
  country,
  type: z.string().trim().min(1, 'Enter the authorization type.').max(200),
  expiresAt: z.iso.date().optional(),
})
export type WorkAuthorization = z.infer<typeof WorkAuthorizationSchema>
const list = z.array(z.string().trim().min(1).max(200)).max(100)
const timezone = z.string().trim().refine((value) => {
  if (!value) return false
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}, 'Enter a valid IANA timezone, such as America/El_Salvador.')

export const EMPLOYMENT_TYPES = ['employee', 'contractor', 'eor'] as const
/**
 * Languages a candidate can work in, as ISO 639-1 codes. A fixed list, so the settings
 * page offers options rather than free text and matching compares codes, not spellings.
 */
export const SPOKEN_LANGUAGES = [
  'en', 'es', 'pt', 'fr', 'de', 'it', 'nl', 'pl', 'ro', 'cs', 'hu', 'el', 'sv', 'da', 'nb', 'fi',
  'ru', 'uk', 'tr', 'ar', 'he', 'hi', 'zh', 'ja', 'ko', 'vi', 'id', 'th',
] as const
export const SpokenLanguageSchema = z.enum(SPOKEN_LANGUAGES)
/** CEFR levels, plus native: the scale application forms use most, and what other wordings map onto. */
export const ENGLISH_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'] as const
export type EnglishLevel = (typeof ENGLISH_LEVELS)[number]
export type SpokenLanguage = z.infer<typeof SpokenLanguageSchema>
export const CandidateProfileInputSchema = z.object({
  country,
  city: z.string().trim().min(1, 'Enter your city.').max(200),
  timezone,
  workAuthorizations: z.array(WorkAuthorizationSchema).max(50),
  willingToRelocate: z.boolean(),
  allowedRegions: z.array(z.string().trim().toLowerCase().regex(/^(worldwide|latam|emea|apac|namer|[a-z]{2})$/, 'Use a region name or two-letter country code.')).min(1).max(100),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).min(1, 'Choose at least one employment arrangement.'),
  salaryFloorMinor: z.number().int().min(0).max(MAX_SALARY_MINOR).nullable(),
  salaryCurrency: z.string().refine((value) => CURRENCIES.includes(value), 'Choose a supported currency.'),
  targetRoles: list.min(1, 'Enter at least one target role.'),
  seniority: z.string().trim().min(1, 'Enter your seniority.').max(200),
  preferredTech: list,
  excludedTech: list,
  excludedCompanies: list,
  excludedIndustries: list,
  /** Facts about the candidate, not a constraint: matching compares them, eligibility never reads them. */
  spokenLanguages: z.array(SpokenLanguageSchema).max(SPOKEN_LANGUAGES.length),
  /** Facts for application questions (decision 0014): eligibility and matching never read them. */
  citizenships: z.array(country).max(5),
  englishLevel: z.enum(ENGLISH_LEVELS).nullable(),
  constraintModes: ConstraintModesSchema,
})
export type CandidateProfileInput = z.infer<typeof CandidateProfileInputSchema>
export const CandidateProfileSchema = CandidateProfileInputSchema.extend({ id: z.uuid(), userId: z.uuid() })
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>
