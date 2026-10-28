import type { VerifiedCareerItem } from '@/modules/career-knowledge'
import type { FormField, FormQuestion } from '@/modules/job-sources'
import { experienceMonths, skillKey } from '@/modules/matching'
import { REGION_COUNTRIES } from '@/modules/eligibility'
import type { CandidateProfile, EnglishLevel } from '@/modules/profiles'
import { isProfileReading, type QuestionReading } from './question-reading.js'
import type { SavedAnswerValue } from './readiness.js'

/*
 * Profile-fact drafts (decision 0014): a model read what the question asks; this code answers
 * it from the candidate's profile and confirmed career items, and picks the form's option.
 * Anything the record cannot settle is "no basis", with the reason the owner can act on.
 */

export type ProfileFacts = {
  readonly profile: Pick<CandidateProfile,
    'country' | 'city' | 'timezone' | 'citizenships' | 'workAuthorizations' | 'englishLevel' | 'willingToRelocate' | 'salaryFloorMinor' | 'salaryCurrency' | 'spokenLanguages'>
  readonly items: readonly Pick<VerifiedCareerItem, 'id' | 'type' | 'organization' | 'title' | 'startedOn' | 'endedOn' | 'isCurrent' | 'technologies'>[]
  readonly today: Date
}

export type ProfileDraft =
  | { readonly kind: 'drafted'; readonly answer: SavedAnswerValue; readonly basis: readonly string[]; readonly itemIds: readonly string[] }
  | { readonly kind: 'no_basis'; readonly reason: string }

/** A fact, before it is put into the form's own terms. */
type Fact =
  | { readonly kind: 'yes_no'; readonly value: boolean }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'countries'; readonly codes: readonly string[] }
  | { readonly kind: 'currency'; readonly code: string }
  | { readonly kind: 'level'; readonly level: EnglishLevel }
  | { readonly kind: 'languages'; readonly codes: readonly string[] }
  | { readonly kind: 'years'; readonly years: number }
  | { readonly kind: 'time_zone'; readonly zone: string; readonly offset: string; readonly region: ZoneRegion | null }

/** How forms group time zones ("American Time Zones", "EMEA", "APAC"). */
type ZoneRegion = 'americas' | 'emea' | 'apac'
const ZONE_OPTIONS: Readonly<Record<ZoneRegion, RegExp>> = {
  americas: /\bameric/,
  emea: /\bemea\b|\beurope\b|\bmiddle east\b|\bafrica/,
  apac: /\bapac\b|\basia\b|\bpacific\b/,
}

function zoneRegion(country: string): ZoneRegion | null {
  if (REGION_COUNTRIES.latam.includes(country) || REGION_COUNTRIES.namer.includes(country)) return 'americas'
  if (REGION_COUNTRIES.emea.includes(country)) return 'emea'
  return REGION_COUNTRIES.apac.includes(country) ? 'apac' : null
}

/** "GMT-06:00" for the zone on `day`; daylight saving moves it. */
const offsetOf = (zone: string, day: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(day).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'

type Found = { readonly fact: Fact; readonly basis: readonly string[]; readonly itemIds?: readonly string[] }
type Outcome = Found | { readonly reason: string }

const regionNames = new Intl.DisplayNames('en', { type: 'region' })
const languageNames = new Intl.DisplayNames('en', { type: 'language' })
const countryName = (code: string) => regionNames.of(code) ?? code
const languageName = (code: string) => languageNames.of(code) ?? code
const names = (codes: readonly string[]) => codes.map(countryName).join(', ')
const normalized = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim()
const noBasis = (reason: string): Outcome => ({ reason })

const LEVEL_TEXT: Record<EnglishLevel, string> = {
  A1: 'A1 (beginner)', A2: 'A2 (elementary)', B1: 'B1 (intermediate)', B2: 'B2 (upper intermediate)',
  C1: 'C1 (advanced)', C2: 'C2 (proficient)', native: 'Native or bilingual',
}
/** The words forms use for each level, best first. */
const LEVEL_WORDS: Record<EnglishLevel, readonly RegExp[]> = {
  A1: [/\bbeginner\b/, /\bbasic\b/], A2: [/\belementary\b/, /\bbasic\b/], B1: [/^intermediate\b/, /\bintermediate\b/],
  B2: [/\bupper intermediate\b/, /\bintermediate\b/], C1: [/\badvanced\b/], C2: [/\bproficient\b/, /\bfluent\b/, /\badvanced\b/],
  native: [/\bnative\b/, /\bbilingual\b/, /\bfluent\b/],
}

// ---------------------------------------------------------------------------
// Facts from the record

function authorizedCountries(facts: ProfileFacts): string[] {
  const today = facts.today.toISOString().slice(0, 10)
  const held = facts.profile.workAuthorizations.filter((a) => a.expiresAt === undefined || a.expiresAt >= today).map((a) => a.country)
  return [...new Set([...facts.profile.citizenships, ...held])]
}

function authorizationBasis(facts: ProfileFacts): string[] {
  const held = facts.profile.workAuthorizations.map((a) => `${countryName(a.country)} (${a.type}${a.expiresAt ? `, until ${a.expiresAt}` : ''})`)
  return [
    `Citizenship: ${facts.profile.citizenships.length > 0 ? names(facts.profile.citizenships) : 'not stated'}`,
    `Work authorizations: ${held.length > 0 ? held.join(', ') : 'none'}`,
    `Country of residence: ${countryName(facts.profile.country)}`,
  ]
}

const NEEDS_CITIZENSHIP = 'Add your citizenship in Settings: without it, work authorization questions cannot be answered from your profile.'

/** Where the question asks about: the countries it names, or else where the candidate lives and would work from. */
const placesOf = (reading: QuestionReading, facts: ProfileFacts) => reading.countries.length > 0 ? reading.countries : [facts.profile.country]

function workAuthorization(reading: QuestionReading, facts: ProfileFacts): Outcome {
  const authorized = authorizedCountries(facts)
  const coversAll = placesOf(reading, facts).every((code) => authorized.includes(code))
  const basis = authorizationBasis(facts)
  // "Not authorized" is only as reliable as the citizenship list: it must be stated to say no.
  if (!coversAll && facts.profile.citizenships.length === 0) return noBasis(NEEDS_CITIZENSHIP)
  const value = reading.kind === 'needs_sponsorship' ? !coversAll : coversAll
  return { fact: { kind: 'yes_no', value }, basis }
}

function roles(facts: ProfileFacts) {
  return facts.items.filter((item) => item.type === 'role')
}

/** Current roles first, then the most recently ended. */
function latestRole(facts: ProfileFacts) {
  const recency = (item: ProfileFacts['items'][number]) => item.isCurrent ? '9999' : item.endedOn ?? item.startedOn ?? '0000'
  return [...roles(facts)].sort((a, b) => recency(b).localeCompare(recency(a)))[0]
}

function careerFact(reading: QuestionReading, facts: ProfileFacts): Outcome {
  const noRoles = 'Your career record has no confirmed roles to answer this from.'
  switch (reading.kind) {
    case 'current_title':
    case 'current_employer': {
      const role = latestRole(facts)
      if (!role) return noBasis(noRoles)
      const value = reading.kind === 'current_title' ? role.title : role.organization
      if (!value) {
        const missing = reading.kind === 'current_title' ? 'title' : 'employer'
        return noBasis(`Your latest role, ${role.organization ?? role.title ?? 'the current one'}, has no ${missing}; add it in Career.`)
      }
      return { fact: { kind: 'text', text: value }, basis: [`Latest role: ${role.title ?? 'untitled'} at ${role.organization ?? 'an unnamed organization'}`], itemIds: [role.id] }
    }
    case 'worked_at': {
      if (!reading.company) return noBasis('The question names no company.')
      if (roles(facts).length === 0) return noBasis(noRoles)
      const company = normalized(reading.company)
      const matches = roles(facts).filter((role) => {
        const organization = normalized(role.organization ?? '')
        return organization !== '' && (organization.includes(company) || company.includes(organization))
      })
      const employers = [...new Set(roles(facts).map((role) => role.organization).filter((o): o is string => o !== null))]
      return { fact: { kind: 'yes_no', value: matches.length > 0 }, basis: [`Employers in your career record: ${employers.join(', ')}`], itemIds: matches.map((m) => m.id) }
    }
    case 'years_of_experience': {
      const all = roles(facts)
      if (all.length === 0) return noBasis(noRoles)
      const skill = reading.skill
      const counted = skill === null ? all : all.filter((role) => role.technologies.some((t) => skillKey(t) === skillKey(skill)))
      const subject = skill === null ? 'professional experience' : `experience with ${skill}`
      if (counted.length === 0) return { fact: { kind: 'years', years: 0 }, basis: [`No confirmed role lists ${skill ?? 'a skill'}`] }
      const months = experienceMonths(counted, facts.today)
      if (months === null) return noBasis(`Your confirmed roles have no dates to count ${subject} from.`)
      return { fact: { kind: 'years', years: Math.floor(months / 12) }, basis: [`At least ${months} months of ${subject}, from your confirmed roles' dates`], itemIds: counted.map((r) => r.id) }
    }
    case 'recent_graduate': {
      const education = facts.items.filter((item) => item.type === 'education' && (item.endedOn !== null || item.isCurrent))
      if (education.length === 0) return noBasis('Your career record has no confirmed education with dates.')
      const window = reading.withinYears ?? 2
      const cutoff = facts.today.getUTCFullYear() - window
      // A year alone is read as its end: "2023" counts as graduating in December 2023.
      const recent = education.filter((item) => item.isCurrent || Number(item.endedOn?.slice(0, 4)) >= cutoff)
      return { fact: { kind: 'yes_no', value: recent.length > 0 }, basis: education.map((e) => `${e.title ?? 'Education'}: ${e.isCurrent ? 'ongoing' : `ended ${e.endedOn}`}`), itemIds: education.map((e) => e.id) }
    }
    default:
      return noBasis('Not a career fact.')
  }
}

function salary(reading: QuestionReading, facts: ProfileFacts): Outcome {
  const { salaryFloorMinor: floor, salaryCurrency: currency } = facts.profile
  if (floor === null) return noBasis('Add a minimum salary in Settings to answer salary questions.')
  if (reading.currency !== null && reading.currency !== currency) return noBasis(`The question asks in ${reading.currency}; your minimum salary is in ${currency}. Currencies are not converted.`)
  if (reading.period === 'hour') return noBasis('The question asks for an hourly rate; your profile states a yearly minimum.')
  const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  const yearly = floor / 10 ** digits
  const amount = reading.period === 'month' ? Math.round(yearly / 12) : yearly
  const text = `${currency} ${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })} per ${reading.period === 'month' ? 'month' : 'year'}`
  return { fact: { kind: 'text', text }, basis: [`Minimum salary: ${currency} ${yearly.toLocaleString('en-US')} per year`] }
}

function factFor(reading: QuestionReading, facts: ProfileFacts): Outcome {
  const { profile } = facts
  switch (reading.kind) {
    case 'authorized_in':
    case 'needs_sponsorship':
      return workAuthorization(reading, facts)
    case 'authorized_countries':
      if (profile.citizenships.length === 0) return noBasis(NEEDS_CITIZENSHIP)
      return { fact: { kind: 'countries', codes: authorizedCountries(facts) }, basis: authorizationBasis(facts) }
    case 'citizen_of':
      if (profile.citizenships.length === 0) return noBasis('Add your citizenship in Settings to answer citizenship questions.')
      if (reading.countries.length === 0) return noBasis('The question names no country.')
      return { fact: { kind: 'yes_no', value: profile.citizenships.some((c) => reading.countries.includes(c)) }, basis: [`Citizenship: ${names(profile.citizenships)}`] }
    case 'resident_of':
      if (reading.countries.length === 0) return noBasis('The question names no country.')
      return { fact: { kind: 'yes_no', value: reading.countries.includes(profile.country) }, basis: [`Country of residence: ${countryName(profile.country)}`] }
    case 'country_of_residence':
      return { fact: { kind: 'countries', codes: [profile.country] }, basis: [`Country of residence: ${countryName(profile.country)}`] }
    case 'city_of_residence':
      return { fact: { kind: 'text', text: profile.city }, basis: [`City: ${profile.city}`] }
    case 'time_zone':
      return {
        fact: { kind: 'time_zone', zone: profile.timezone, offset: offsetOf(profile.timezone, facts.today), region: zoneRegion(profile.country) },
        basis: [`Time zone: ${profile.timezone}`, `Country of residence: ${countryName(profile.country)}`],
      }
    case 'willing_to_relocate':
      return { fact: { kind: 'yes_no', value: profile.willingToRelocate }, basis: [`Willing to relocate: ${profile.willingToRelocate ? 'yes' : 'no'}`] }
    case 'salary_expectation':
      return salary(reading, facts)
    case 'salary_currency':
      return { fact: { kind: 'currency', code: profile.salaryCurrency }, basis: [`Salary currency: ${profile.salaryCurrency}`] }
    case 'language_level':
      if (reading.language !== 'en') return noBasis(`Your profile records no level for ${languageName(reading.language ?? 'this language')}.`)
      if (profile.englishLevel === null) return noBasis('Add your English level in Settings to answer this.')
      return { fact: { kind: 'level', level: profile.englishLevel }, basis: [`English level: ${LEVEL_TEXT[profile.englishLevel]}`] }
    case 'spoken_languages':
      if (profile.spokenLanguages.length === 0) return noBasis('Add the languages you work in to Settings.')
      return { fact: { kind: 'languages', codes: profile.spokenLanguages }, basis: [`Languages you work in: ${profile.spokenLanguages.map(languageName).join(', ')}`] }
    default:
      return careerFact(reading, facts)
  }
}

// ---------------------------------------------------------------------------
// Into the form's own terms

const choiceField = (q: FormQuestion) => q.fields.find((f) => f.type === 'single_select') ?? q.fields.find((f) => f.type === 'multi_select')
const textField = (q: FormQuestion) => q.fields.find((f) => f.type === 'textarea') ?? q.fields.find((f) => f.type === 'text')

const YES = /^(yes|si|sí)\b/
const NO = /^no\b/

type Chosen = { readonly labels: readonly string[] } | { readonly reason: string }

function single(options: readonly FormField['options'][number][], wanted: string): Chosen {
  if (options.length === 1) return { labels: [options[0]?.label ?? ''] }
  return { reason: options.length === 0 ? `None of the form's options says “${wanted}”.` : `More than one option means “${wanted}”; choose the right one yourself.` }
}

/** The lowest number of years an option covers, and the highest (null: no limit). */
function yearsRange(label: string): readonly [number, number | null] | null {
  const text = normalized(label)
  let match = /^less than (\d+)/.exec(text) ?? /^under (\d+)/.exec(text)
  if (match) return [0, Number(match[1]) - 1]
  match = /^(\d+)\s*(\+|or more|and more|plus)/.exec(text)
  if (match) return [Number(match[1]), null]
  match = /^(\d+)\s*(to|\s)\s*(\d+)/.exec(text)
  if (match) return [Number(match[1]), Number(match[3])]
  match = /^(\d+)$/.exec(text)
  return match ? [Number(match[1]), Number(match[1])] : null
}

function chooseOptions(field: FormField, fact: Fact): Chosen {
  const options = field.options
  const labelled = (pattern: (label: string) => boolean) => options.filter((o) => pattern(normalized(o.label)))
  switch (fact.kind) {
    case 'yes_no':
      return single(labelled((label) => (fact.value ? YES : NO).test(label)), fact.value ? 'yes' : 'no')
    case 'countries': {
      const wanted = fact.codes.map((code) => normalized(countryName(code)))
      const found = labelled((label) => wanted.includes(label))
      if (field.type === 'multi_select') return found.length > 0 ? { labels: found.map((o) => o.label) } : { reason: 'None of the form\'s options names your countries.' }
      return fact.codes.length === 1 ? single(found, countryName(fact.codes[0] ?? '')) : { reason: 'The form takes one country; you have several.' }
    }
    case 'currency':
      return single(labelled((label) => new RegExp(`\\b${fact.code.toLowerCase()}\\b`).test(label)), fact.code)
    case 'level': {
      const code = new RegExp(`\\b${fact.level.toLowerCase()}\\b`)
      const byCode = labelled((label) => code.test(label))
      if (byCode.length > 0) return single(byCode, fact.level)
      for (const word of LEVEL_WORDS[fact.level]) {
        const found = labelled((label) => word.test(label))
        if (found.length > 0) return single(found, LEVEL_TEXT[fact.level])
      }
      return { reason: `None of the form's options matches ${LEVEL_TEXT[fact.level]}.` }
    }
    case 'languages': {
      const wanted = fact.codes.map((code) => normalized(languageName(code)))
      const found = labelled((label) => wanted.includes(label))
      if (field.type === 'single_select') return { reason: 'The form takes one language; you work in several.' }
      return found.length > 0 ? { labels: found.map((o) => o.label) } : { reason: 'None of the form\'s options names your languages.' }
    }
    case 'years': {
      const covering = options
        .map((o) => ({ label: o.label, range: yearsRange(o.label) }))
        .filter((o) => o.range !== null && o.range[0] <= fact.years && (o.range[1] === null || fact.years <= o.range[1]))
      // Where ranges share a boundary ("3-5", "5-8"), the one starting nearest says the most.
      const best = covering.sort((a, b) => (b.range?.[0] ?? 0) - (a.range?.[0] ?? 0))[0]
      return best ? { labels: [best.label] } : { reason: `None of the form's options covers ${fact.years} years.` }
    }
    case 'text':
      return single(labelled((label) => label === normalized(fact.text)), fact.text)
    case 'time_zone': {
      const pattern = fact.region ? ZONE_OPTIONS[fact.region] : null
      const found = pattern ? labelled((label) => pattern.test(label)) : []
      return found.length === 1 ? { labels: [found[0]?.label ?? ''] } : { reason: 'None of the form\'s options names your time zone\'s region; choose it yourself.' }
    }
  }
}

function asText(fact: Fact): string {
  switch (fact.kind) {
    case 'yes_no': return fact.value ? 'Yes' : 'No'
    case 'text': return fact.text
    case 'countries': return names(fact.codes)
    case 'currency': return fact.code
    case 'level': return LEVEL_TEXT[fact.level]
    case 'languages': return fact.codes.map(languageName).join(', ')
    case 'years': return `${fact.years} year${fact.years === 1 ? '' : 's'}`
    case 'time_zone': return `${fact.zone} (${fact.offset})`
  }
}

/** A draft for a question whose reading is a profile fact; null for any other reading. */
export function answerFromProfile(question: FormQuestion, reading: QuestionReading, facts: ProfileFacts): ProfileDraft | null {
  if (!isProfileReading(reading.kind)) return null
  const outcome = factFor(reading, facts)
  if ('reason' in outcome) return { kind: 'no_basis', reason: outcome.reason }
  const base = { basis: outcome.basis, itemIds: outcome.itemIds ?? [] }
  const choice = choiceField(question)
  if (choice) {
    const picked = chooseOptions(choice, outcome.fact)
    return 'reason' in picked ? { kind: 'no_basis', reason: picked.reason } : { kind: 'drafted', answer: { kind: 'choice', labels: picked.labels }, ...base }
  }
  if (textField(question)) return { kind: 'drafted', answer: { kind: 'text', text: asText(outcome.fact) }, ...base }
  return { kind: 'no_basis', reason: 'The form takes no answer this could fill.' }
}
