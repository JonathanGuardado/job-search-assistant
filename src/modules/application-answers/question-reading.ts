import { z } from 'zod'

/*
 * What an application question asks, as a model reads it (decision 0014). A reading names a
 * fact, never its value: "needs sponsorship to work in: US", not "no". Code answers it.
 */

/** Facts code answers from the profile and confirmed career items. */
export const PROFILE_READINGS = [
  'authorized_in', 'authorized_countries', 'needs_sponsorship', 'citizen_of', 'resident_of', 'country_of_residence',
  'city_of_residence', 'time_zone', 'willing_to_relocate', 'salary_expectation', 'salary_currency', 'language_level', 'spoken_languages',
  'current_title', 'current_employer', 'worked_at', 'years_of_experience', 'recent_graduate',
] as const
/** experience and motivation are written by a model and checked; owner_only is never drafted. */
export const READING_KINDS = [...PROFILE_READINGS, 'experience', 'motivation', 'owner_only'] as const
export type ReadingKind = (typeof READING_KINDS)[number]
export type ProfileReadingKind = (typeof PROFILE_READINGS)[number]

export const SALARY_PERIODS = ['year', 'month', 'hour'] as const

/**
 * Flat, with every key present: constrained decoding skips optional keys (eligibility eval,
 * prompt v2). Keys a kind does not use are empty or null.
 */
export const QuestionReadingSchema = z.object({
  kind: z.enum(READING_KINDS),
  /** ISO 3166-1 alpha-2 codes the question names; empty when it names none ("where this job is based"). */
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(60),
  /** worked_at: the company asked about. */
  company: z.string().max(200).nullable(),
  /** years_of_experience: the skill asked about; null for experience overall. */
  skill: z.string().max(200).nullable(),
  /** language_level: ISO 639-1 code. */
  language: z.string().regex(/^[a-z]{2}$/).nullable(),
  /** salary_expectation: the period and currency the question states. */
  period: z.enum(SALARY_PERIODS).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  /** recent_graduate: the window the question asks about, in years. */
  withinYears: z.number().int().min(0).max(20).nullable(),
})
export type QuestionReading = z.infer<typeof QuestionReadingSchema>

export const NO_DETAILS: Omit<QuestionReading, 'kind'> = {
  countries: [], company: null, skill: null, language: null, period: null, currency: null, withinYears: null,
}

export const isProfileReading = (kind: ReadingKind): kind is ProfileReadingKind =>
  (PROFILE_READINGS as readonly string[]).includes(kind)

/**
 * The model's output, loosely typed: one malformed code should not fail a whole batch of
 * readings. `readingFrom` keeps only what is well formed.
 */
export const RawReadingSchema = z.object({
  id: z.string(),
  kind: z.enum(READING_KINDS),
  countries: z.array(z.string()),
  company: z.string().nullable(),
  skill: z.string().nullable(),
  language: z.string().nullable(),
  period: z.enum(SALARY_PERIODS).nullable(),
  currency: z.string().nullable(),
  withinYears: z.number().nullable(),
})
export type RawReading = z.infer<typeof RawReadingSchema>

const regionNames = new Intl.DisplayNames('en', { type: 'region' })
const isCountry = (code: string) => {
  const name = /^[A-Z]{2}$/.test(code) ? regionNames.of(code) : undefined
  return name !== undefined && name !== code && !/unknown/i.test(name)
}
const text = (value: string | null) => value?.trim() ? value.trim().slice(0, 200) : null

/** A stored reading from the model's: unknown country codes dropped, codes normalized, anything malformed null. */
export function readingFrom(raw: RawReading): QuestionReading {
  const language = raw.language?.trim().toLowerCase() ?? ''
  const currency = raw.currency?.trim().toUpperCase() ?? ''
  const within = raw.withinYears
  return QuestionReadingSchema.parse({
    kind: raw.kind,
    countries: [...new Set(raw.countries.map((c) => c.trim().toUpperCase()).filter(isCountry))].slice(0, 60),
    company: text(raw.company),
    skill: text(raw.skill),
    language: /^[a-z]{2}$/.test(language) ? language : null,
    period: raw.period,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    withinYears: within !== null && Number.isInteger(within) && within >= 0 && within <= 20 ? within : null,
  })
}
