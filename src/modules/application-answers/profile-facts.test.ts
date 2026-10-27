import { describe, expect, it } from 'vitest'
import type { FormQuestion } from '@/modules/job-sources'
import { answerFromProfile, type ProfileFacts } from './profile-facts.js'
import { NO_DETAILS, type QuestionReading } from './question-reading.js'

const today = new Date('2026-10-26T12:00:00Z')
const read = (kind: QuestionReading['kind'], details: Partial<Omit<QuestionReading, 'kind'>> = {}): QuestionReading => ({ kind, ...NO_DETAILS, ...details })
const choice = (label: string, options: string[], type: 'single_select' | 'multi_select' = 'single_select'): FormQuestion => ({
  label, description: null, required: true, section: 'main',
  fields: [{ name: 'question_1', type, options: options.map((o, i) => ({ label: o, value: String(i) })) }],
})
const text = (label: string): FormQuestion => ({ label, description: null, required: true, section: 'main', fields: [{ name: 'question_2', type: 'text', options: [] }] })
const yesNo = (label: string) => choice(label, ['Yes', 'No'])

const facts: ProfileFacts = {
  profile: {
    country: 'SV', city: 'San Salvador', citizenships: ['SV'], workAuthorizations: [], englishLevel: 'C1', willingToRelocate: true,
    salaryFloorMinor: 6_000_000, salaryCurrency: 'USD', spokenLanguages: ['es', 'en'],
  },
  items: [
    { id: 'acme', type: 'role', organization: 'Acme Corp', title: 'Senior Software Engineer', startedOn: '2019-03', endedOn: null, isCurrent: true, technologies: ['Python', 'PostgreSQL'] },
    { id: 'globex', type: 'role', organization: 'Globex', title: 'Software Engineer', startedOn: '2015', endedOn: '2019-02', isCurrent: false, technologies: ['Java'] },
    { id: 'uni', type: 'education', organization: 'Universidad Centroamericana', title: 'BSc Computer Science', startedOn: '2010', endedOn: '2014', isCurrent: false, technologies: [] },
  ],
  today,
}
const withProfile = (changes: Partial<ProfileFacts['profile']>): ProfileFacts => ({ ...facts, profile: { ...facts.profile, ...changes } })
const drafted = (answer: unknown) => expect.objectContaining({ kind: 'drafted', answer })
const noBasis = (reason: RegExp) => expect.objectContaining({ kind: 'no_basis', reason: expect.stringMatching(reason) })

describe('answering work authorization from the profile', () => {
  const elastic = yesNo("Will you require Elastic's sponsorship to continue or extend your work authorization status?")

  it('needs no sponsorship where the candidate is a citizen, reading an unnamed place as where they live', () => {
    expect(answerFromProfile(elastic, read('needs_sponsorship'), facts)).toEqual(drafted({ kind: 'choice', labels: ['No'] }))
  })

  it('needs sponsorship for a named country they hold nothing for', () => {
    expect(answerFromProfile(elastic, read('needs_sponsorship', { countries: ['US'] }), facts)).toEqual(drafted({ kind: 'choice', labels: ['Yes'] }))
  })

  it('counts a work authorization that has not expired, and not one that has', () => {
    const holdsUs = withProfile({ workAuthorizations: [{ country: 'US', type: 'Green card' }] })
    expect(answerFromProfile(elastic, read('needs_sponsorship', { countries: ['US'] }), holdsUs)).toEqual(drafted({ kind: 'choice', labels: ['No'] }))
    const expired = withProfile({ workAuthorizations: [{ country: 'US', type: 'H-1B', expiresAt: '2025-01-31' }] })
    expect(answerFromProfile(elastic, read('needs_sponsorship', { countries: ['US'] }), expired)).toEqual(drafted({ kind: 'choice', labels: ['Yes'] }))
  })

  it('will not say "yes, I need sponsorship" without knowing the citizenship', () => {
    const unknown = withProfile({ citizenships: [] })
    expect(answerFromProfile(elastic, read('needs_sponsorship', { countries: ['US'] }), unknown)).toEqual(noBasis(/citizenship/i))
    expect(answerFromProfile(elastic, read('needs_sponsorship'), unknown)).toEqual(noBasis(/citizenship/i))
  })

  it('picks the one plain "No" among options that each name a visa', () => {
    const gitlab = choice('Will you now or in the future require sponsorship for a visa to remain in your current location?',
      ['No', 'Yes, Netherlands Highly Skilled Migrant Visa', 'Yes, EU Blue Card', 'Yes, F-1 Visa OPT (USA)'])
    expect(answerFromProfile(gitlab, read('needs_sponsorship'), facts)).toEqual(drafted({ kind: 'choice', labels: ['No'] }))
  })

  it('leaves a question whose options mean "yes" more than one way to the owner', () => {
    const datadog = choice('Are you legally authorised to work full-time in the country where this job is based?',
      ['Yes, no restriction.', 'Yes, but I will need sponsorship in the future.', 'No, I need sponsorship now.'])
    expect(answerFromProfile(datadog, read('authorized_in'), facts)).toEqual(noBasis(/option/i))
  })

  it('lists the countries the candidate may work in', () => {
    const countries = text('In what countries do you have the unrestricted right to work?')
    expect(answerFromProfile(countries, read('authorized_countries'), facts)).toEqual(drafted({ kind: 'text', text: 'El Salvador' }))
    const two = withProfile({ workAuthorizations: [{ country: 'ES', type: 'Residence permit' }] })
    expect(answerFromProfile(countries, read('authorized_countries'), two)).toEqual(drafted({ kind: 'text', text: 'El Salvador, Spain' }))
  })

  it('answers citizenship and residence lists from the profile', () => {
    const sanctioned = ['CU', 'IR', 'KP', 'SY']
    const q = yesNo('Is your most recent country of citizenship one of the following countries: Cuba, Iran, North Korea, Syria?')
    expect(answerFromProfile(q, read('citizen_of', { countries: sanctioned }), facts)).toEqual(drafted({ kind: 'choice', labels: ['No'] }))
    expect(answerFromProfile(q, read('citizen_of', { countries: sanctioned }), withProfile({ citizenships: [] }))).toEqual(noBasis(/citizenship/i))
    const located = yesNo('Are you located in one of the following countries or regions: Belarus, Cuba, Iran?')
    expect(answerFromProfile(located, read('resident_of', { countries: ['BY', 'CU', 'IR'] }), facts)).toEqual(drafted({ kind: 'choice', labels: ['No'] }))
    expect(answerFromProfile(located, read('resident_of', { countries: ['SV'] }), facts)).toEqual(drafted({ kind: 'choice', labels: ['Yes'] }))
  })

  it('picks the country of residence among the options, or writes it', () => {
    const gitlab = choice('What is your current country of residence?', ['Afghanistan', 'Ecuador', 'Egypt', 'El Salvador', 'Estonia'])
    expect(answerFromProfile(gitlab, read('country_of_residence'), facts)).toEqual(drafted({ kind: 'choice', labels: ['El Salvador'] }))
    expect(answerFromProfile(text('Country'), read('country_of_residence'), facts)).toEqual(drafted({ kind: 'text', text: 'El Salvador' }))
    expect(answerFromProfile(text('City'), read('city_of_residence'), facts)).toEqual(drafted({ kind: 'text', text: 'San Salvador' }))
  })

  it('answers relocation from the profile', () => {
    const q = yesNo('Are you open to relocating?')
    expect(answerFromProfile(q, read('willing_to_relocate'), facts)).toEqual(drafted({ kind: 'choice', labels: ['Yes'] }))
    expect(answerFromProfile(q, read('willing_to_relocate'), withProfile({ willingToRelocate: false }))).toEqual(drafted({ kind: 'choice', labels: ['No'] }))
  })
})

describe('answering pay and language from the profile', () => {
  it('states the minimum salary in the period and currency asked', () => {
    const monthly = text('Please share your monthly salary expectation')
    expect(answerFromProfile(monthly, read('salary_expectation', { period: 'month' }), facts)).toEqual(drafted({ kind: 'text', text: 'USD 5,000 per month' }))
    expect(answerFromProfile(text('Expected salary'), read('salary_expectation'), facts)).toEqual(drafted({ kind: 'text', text: 'USD 60,000 per year' }))
  })

  it('does not convert currencies, guess an hourly rate, or invent a minimum', () => {
    const q = text('Expected salary')
    expect(answerFromProfile(q, read('salary_expectation', { currency: 'EUR' }), facts)).toEqual(noBasis(/USD/))
    expect(answerFromProfile(q, read('salary_expectation', { period: 'hour' }), facts)).toEqual(noBasis(/hour/i))
    expect(answerFromProfile(q, read('salary_expectation'), withProfile({ salaryFloorMinor: null }))).toEqual(noBasis(/minimum salary/i))
  })

  it('picks the salary currency option', () => {
    expect(answerFromProfile(choice('Currency', ['EUR', 'USD', 'GBP']), read('salary_currency'), facts)).toEqual(drafted({ kind: 'choice', labels: ['USD'] }))
  })

  it('maps the English level onto the form\'s own scale', () => {
    const words = choice('English Level', ['Basic', 'Intermediate', 'Advanced', 'Native'])
    expect(answerFromProfile(words, read('language_level', { language: 'en' }), facts)).toEqual(drafted({ kind: 'choice', labels: ['Advanced'] }))
    const cefr = choice('English Level', ['A2', 'B1', 'B2', 'C1', 'C2'])
    expect(answerFromProfile(cefr, read('language_level', { language: 'en' }), facts)).toEqual(drafted({ kind: 'choice', labels: ['C1'] }))
    expect(answerFromProfile(text('English level'), read('language_level', { language: 'en' }), facts)).toEqual(drafted({ kind: 'text', text: 'C1 (advanced)' }))
    expect(answerFromProfile(words, read('language_level', { language: 'en' }), withProfile({ englishLevel: null }))).toEqual(noBasis(/English level/i))
    expect(answerFromProfile(words, read('language_level', { language: 'fr' }), facts)).toEqual(noBasis(/French/))
  })

  it('selects every language the candidate works in', () => {
    const datadog = choice('Please select all the languages you speak fluently.', ['Arabic', 'English', 'French', 'Spanish'], 'multi_select')
    expect(answerFromProfile(datadog, read('spoken_languages'), facts)).toEqual(drafted({ kind: 'choice', labels: ['English', 'Spanish'] }))
  })
})

describe('answering from confirmed career items', () => {
  it('names the current title and employer, citing the role', () => {
    expect(answerFromProfile(text('What is your current or previous job title?'), read('current_title'), facts))
      .toEqual(expect.objectContaining({ kind: 'drafted', answer: { kind: 'text', text: 'Senior Software Engineer' }, itemIds: ['acme'] }))
    expect(answerFromProfile(text('Who is your current or previous employer?'), read('current_employer'), facts))
      .toEqual(drafted({ kind: 'text', text: 'Acme Corp' }))
  })

  it('answers whether the candidate worked at a company from the roles they confirmed', () => {
    const gitlab = yesNo('Have you previously worked at or consulted for GitLab?')
    expect(answerFromProfile(gitlab, read('worked_at', { company: 'GitLab' }), facts)).toEqual(drafted({ kind: 'choice', labels: ['No'] }))
    expect(answerFromProfile(gitlab, read('worked_at', { company: 'Acme' }), facts)).toEqual(drafted({ kind: 'choice', labels: ['Yes'] }))
    expect(answerFromProfile(gitlab, read('worked_at', { company: 'GitLab' }), { ...facts, items: [] })).toEqual(noBasis(/career/i))
  })

  it('counts years of experience the least the dates can mean, overall or with one skill', () => {
    const ranges = choice('Years of professional experience', ['Less than 3 years', '3-5 years', '5-8 years', '8+ years'])
    expect(answerFromProfile(ranges, read('years_of_experience'), facts)).toEqual(drafted({ kind: 'choice', labels: ['8+ years'] }))
    expect(answerFromProfile(text('Years with Python'), read('years_of_experience', { skill: 'python' }), facts)).toEqual(drafted({ kind: 'text', text: '7 years' }))
    expect(answerFromProfile(text('Years with Rust'), read('years_of_experience', { skill: 'Rust' }), facts)).toEqual(drafted({ kind: 'text', text: '0 years' }))
  })

  it('answers recent graduation from education dates', () => {
    const q = yesNo('Are you due to graduate soon, or have you graduated from university in the past two years?')
    expect(answerFromProfile(q, read('recent_graduate', { withinYears: 2 }), facts)).toEqual(drafted({ kind: 'choice', labels: ['No'] }))
    const recent = { ...facts, items: [{ id: 'uni', type: 'education' as const, organization: 'UCA', title: 'MSc', startedOn: '2024', endedOn: '2025-06', isCurrent: false, technologies: [] }] }
    expect(answerFromProfile(q, read('recent_graduate', { withinYears: 2 }), recent)).toEqual(drafted({ kind: 'choice', labels: ['Yes'] }))
  })
})

describe('what profile facts do not answer', () => {
  it('returns nothing for written, motivation and owner-only readings', () => {
    for (const kind of ['experience', 'motivation', 'owner_only'] as const) expect(answerFromProfile(text('Anything'), read(kind), facts)).toBeNull()
  })

  it('records what each answer rests on', () => {
    const result = answerFromProfile(yesNo('Do you need sponsorship?'), read('needs_sponsorship'), facts)
    expect(result).toEqual(expect.objectContaining({ basis: expect.arrayContaining([expect.stringMatching(/Citizenship: El Salvador/)]) }))
  })

  it('gives no answer when a choice question has no option for it', () => {
    expect(answerFromProfile(choice('Do you need sponsorship?', ['Maybe']), read('needs_sponsorship'), facts)).toEqual(noBasis(/option/i))
  })
})
