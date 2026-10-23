import { describe, expect, it } from 'vitest'
import { compareRequirements, type MatchCandidate, type MatchCareerItem, type MatchJob } from './compare.js'
import { NO_REQUIREMENTS, type JobRequirements, type SkillRequirement } from './types.js'

const today = new Date('2026-10-15T00:00:00Z')
let nextId = 0
const uuid = () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`

const item = (overrides: Partial<MatchCareerItem> = {}): MatchCareerItem => ({
  id: uuid(), type: 'role', title: 'Software Engineer', organization: 'Acme', startedOn: '2020-01', endedOn: '2024-01', isCurrent: false,
  summary: null, achievements: [], technologies: [], verifiedByUser: true, ...overrides,
})

const candidate = (overrides: Partial<MatchCandidate['profile']> = {}, careerItems: MatchCareerItem[] = []): MatchCandidate => ({
  profile: {
    targetRoles: ['Senior Software Engineer'], seniority: 'senior', preferredTech: [], excludedTech: [], excludedCompanies: [],
    employmentTypes: ['contractor'], salaryFloorMinor: null, salaryCurrency: 'USD', spokenLanguages: ['es', 'en'], ...overrides,
  },
  careerItems,
})

const job = (overrides: Partial<MatchJob> = {}): MatchJob => ({
  title: 'Senior Software Engineer', companyName: 'Globex', seniority: 'senior', employmentType: 'unknown', salary: { source: 'unknown' }, salaryQuote: null, ...overrides,
})

const skill = (name: string, overrides: Partial<SkillRequirement> = {}): SkillRequirement => ({
  names: [name], importance: 'required', minYears: null, quote: `Experience with ${name}`, ...overrides,
})
const anyOf = (names: string[], overrides: Partial<SkillRequirement> = {}): SkillRequirement => ({
  names, importance: 'required', minYears: null, quote: `Experience with ${names.join(', ')}`, ...overrides,
})
const requires = (overrides: Partial<JobRequirements>): JobRequirements => ({ ...NO_REQUIREMENTS, ...overrides })

describe('skills', () => {
  it('meets a skill listed in a career item, naming the item and whether it is confirmed', () => {
    const role = item({ title: 'Senior Software Engineer', organization: 'FullStack Labs', technologies: ['Node.js'], verifiedByUser: false })
    const result = compareRequirements(job(), requires({ skills: [skill('NodeJS')] }), candidate({}, [role]), today)
    expect(result.dimensions.requiredSkills.status).toBe('meets')
    expect(result.dimensions.requiredSkills.findings[0]).toMatchObject({
      requirement: 'NodeJS', status: 'met',
      evidence: [{ careerItemId: role.id, label: 'Senior Software Engineer at FullStack Labs', via: 'technologies', text: 'Node.js', isVerified: false }],
    })
  })

  it('meets a skill named in an achievement, citing the sentence', () => {
    const sentence = 'Migrated billing to Kubernetes with zero downtime.'
    const result = compareRequirements(job(), requires({ skills: [skill('K8s')] }), candidate({}, [item({ achievements: [sentence] })]), today)
    expect(result.dimensions.requiredSkills.findings[0]?.evidence[0]).toMatchObject({ via: 'text', text: sentence })
  })

  it('meets a skill another listed skill shows', () => {
    const result = compareRequirements(job(), requires({ skills: [skill('SQL')] }), candidate({}, [item({ technologies: ['PostgreSQL'] })]), today)
    expect(result.dimensions.requiredSkills.findings[0]?.evidence[0]).toMatchObject({ via: 'implied', text: 'PostgreSQL' })
  })

  it('reports a missing skill with the posting quote; some missing is partial, all missing is a gap', () => {
    const items = [item({ technologies: ['React'] })]
    const partial = compareRequirements(job(), requires({ skills: [skill('React'), skill('Kubernetes')] }), candidate({}, items), today)
    expect(partial.dimensions.requiredSkills.status).toBe('partial')
    expect(partial.missing).toEqual([expect.objectContaining({ requirement: 'Kubernetes', status: 'missing', quote: 'Experience with Kubernetes' })])
    const none = compareRequirements(job(), requires({ skills: [skill('Kubernetes')] }), candidate({}, items), today)
    expect(none.dimensions.requiredSkills.status).toBe('gap')
  })

  it('compares years per skill from the roles that list it', () => {
    const items = [item({ technologies: ['React'], startedOn: '2023-01', endedOn: '2026-01' }), item({ technologies: ['Java'], startedOn: '2015-01', endedOn: '2023-01' })]
    const short = compareRequirements(job(), requires({ skills: [skill('React', { minYears: 5 })] }), candidate({}, items), today)
    expect(short.dimensions.requiredSkills.findings[0]).toMatchObject({ status: 'short', note: 'asks 5+ years; your record shows at least 3 years' })
    expect(short.dimensions.requiredSkills.status).toBe('partial')
    const enough = compareRequirements(job(), requires({ skills: [skill('React', { minYears: 2 })] }), candidate({}, items), today)
    expect(enough.dimensions.requiredSkills.findings[0]).toMatchObject({ status: 'met', note: 'asks 2+ years; your record shows at least 3 years' })
  })

  it('lists a skill the posting both requires and calls a plus only as required', () => {
    // Wizeline: "Kubernetes." under must-haves and "Docker and/or Kubernetes" under nice-to-haves.
    const result = compareRequirements(job(), requires({ skills: [skill('Kubernetes', { importance: 'preferred' }), skill('K8s'), skill('Docker', { importance: 'preferred' })] }), candidate(), today)
    expect(result.dimensions.requiredSkills.findings.map((f) => f.requirement)).toEqual(['K8s'])
    expect(result.dimensions.preferredSkills.findings.map((f) => f.requirement)).toEqual(['Docker'])
  })

  it('meets a requirement that accepts several skills through any one of them, and names them together', () => {
    // Stripe: "languages such as JavaScript, TypeScript, React, Ruby, Go, or Java".
    const result = compareRequirements(job(), requires({ skills: [anyOf(['Go', 'Ruby', 'Java'])] }), candidate({}, [item({ technologies: ['Ruby on Rails'] })]), today)
    expect(result.dimensions.requiredSkills).toMatchObject({ status: 'meets', findings: [{ requirement: 'Go, Ruby or Java', status: 'met', evidence: [{ via: 'implied' }] }] })
    const none = compareRequirements(job(), requires({ skills: [anyOf(['AWS', 'Azure', 'OCI', 'GCP'])] }), candidate(), today)
    expect(none.concerns).toContain('Missing required: AWS, Azure, OCI or GCP.')
    expect(none.missing).toHaveLength(1)
  })

  it('reads a name written "C/C++" as either skill', () => {
    const result = compareRequirements(job(), requires({ skills: [skill('C/C++')] }), candidate({}, [item({ technologies: ['C++'] })]), today)
    expect(result.dimensions.requiredSkills.findings[0]).toMatchObject({ requirement: 'C or C++', status: 'met' })
  })

  it('drops from a nice-to-have the skills the posting already requires', () => {
    // Wizeline: "Kubernetes." required; "working knowledge of Docker and/or Kubernetes" a plus.
    const result = compareRequirements(job(), requires({ skills: [skill('Kubernetes'), anyOf(['Docker', 'K8s'], { importance: 'preferred' })] }), candidate(), today)
    expect(result.dimensions.preferredSkills.findings.map((f) => f.requirement)).toEqual(['Docker'])
  })

  it('flags an excluded technology only when the posting accepts nothing else', () => {
    const prefs = candidate({ excludedTech: ['PHP'] })
    expect(compareRequirements(job(), requires({ skills: [anyOf(['PHP', 'Python'])] }), prefs, today).dimensions.preferences.status).toBe('not_stated')
    expect(compareRequirements(job(), requires({ skills: [skill('PHP')] }), prefs, today).dimensions.preferences.status).toBe('gap')
  })

  it('keeps preferred skills in their own dimension', () => {
    const result = compareRequirements(job(), requires({ skills: [skill('GraphQL', { importance: 'preferred' })] }), candidate(), today)
    expect(result.dimensions.requiredSkills.status).toBe('not_stated')
    expect(result.dimensions.preferredSkills.status).toBe('gap')
  })
})

describe('overall experience', () => {
  const asks = (minYears: number) => requires({ experience: { minYears, quote: `${minYears}+ years of experience` } })

  it('meets or falls short of the stated years, counting overlapping roles once', () => {
    const items = [item({ startedOn: '2016-01', endedOn: '2020-01' }), item({ startedOn: '2019-01', endedOn: '2024-01' })]
    expect(compareRequirements(job(), asks(7), candidate({}, items), today).dimensions.experience.status).toBe('meets')
    const short = compareRequirements(job(), asks(10), candidate({}, items), today).dimensions.experience
    expect(short).toMatchObject({ status: 'gap', findings: [{ status: 'short', note: 'asks 10+ years; your record shows at least 8 years' }] })
  })

  it('is unknown when no role has usable dates, and not stated when the posting asks nothing', () => {
    expect(compareRequirements(job(), asks(3), candidate({}, [item({ startedOn: null })]), today).dimensions.experience.status).toBe('unknown')
    expect(compareRequirements(job(), NO_REQUIREMENTS, candidate(), today).dimensions.experience.status).toBe('not_stated')
  })
})

describe('languages', () => {
  const asks = (language: string, importance: 'required' | 'preferred' = 'required') =>
    requires({ languages: [{ language, importance, quote: `Fluent ${language}` }] })

  it('meets a language the candidate selected and flags a required one they did not', () => {
    expect(compareRequirements(job(), asks('es'), candidate(), today).dimensions.languages.status).toBe('meets')
    const missing = compareRequirements(job(), asks('pt'), candidate(), today)
    expect(missing.dimensions.languages).toMatchObject({ status: 'gap', findings: [{ requirement: 'Portuguese', status: 'missing' }] })
    expect(missing.concerns).toContain('Requires Portuguese, which is not in your languages.')
  })

  it('a missing preferred language is partial; an empty language setting is unknown', () => {
    expect(compareRequirements(job(), asks('de', 'preferred'), candidate(), today).dimensions.languages.status).toBe('partial')
    expect(compareRequirements(job(), asks('pt'), candidate({ spokenLanguages: [] }), today).dimensions.languages.status).toBe('unknown')
  })
})

describe('role and seniority', () => {
  it.each([
    ['Senior Software Engineer', 'meets'],
    ['Software Engineer, Full Stack', 'meets'],
    ['Senior Backend Engineer', 'partial'],
    ['Product Designer', 'gap'],
  ] as const)('title %s against targets is %s', (title, status) => {
    const targets = candidate({ targetRoles: ['Senior Software Engineer', 'Full-stack developer'] })
    expect(compareRequirements(job({ title }), NO_REQUIREMENTS, targets, today).dimensions.role.status).toBe(status)
  })

  it.each([
    ['senior', 'meets'], ['staff', 'partial'], ['lead', 'partial'], ['principal', 'gap'], ['junior', 'partial'], ['intern', 'gap'], [null, 'not_stated'],
  ] as const)('a %s posting for a senior candidate is %s', (seniority, status) => {
    expect(compareRequirements(job({ seniority }), NO_REQUIREMENTS, candidate(), today).dimensions.seniority.status).toBe(status)
  })
})

describe('salary', () => {
  const posted = (minMinor: number | null, maxMinor: number | null, currency = 'USD') => job({ salary: { source: 'posted', minMinor, maxMinor, currency } })
  const floor = candidate({ salaryFloorMinor: 6_000_000 })

  it.each([
    [posted(7_000_000, 9_000_000), 'above', 'meets'],
    [posted(5_000_000, 9_000_000), 'within', 'meets'],
    [posted(4_000_000, 5_000_000), 'below', 'gap'],
    [posted(4_000_000, 5_000_000, 'EUR'), 'unknown', 'unknown'],
    [job(), 'unknown', 'unknown'],
  ] as const)('%#: %s', (posting, compatibility, status) => {
    const result = compareRequirements(posting, NO_REQUIREMENTS, floor, today)
    expect(result.salaryCompatibility).toBe(compatibility)
    expect(result.dimensions.salary.status).toBe(status)
  })

  it('says what was posted against the floor', () => {
    expect(compareRequirements(posted(4_000_000, 5_000_000), NO_REQUIREMENTS, floor, today).concerns)
      .toContain('Pays $40,000–$50,000, below your $60,000 floor.')
  })

  it('is not stated without a floor', () => {
    expect(compareRequirements(posted(4_000_000, 5_000_000), NO_REQUIREMENTS, candidate(), today).dimensions.salary.status).toBe('not_stated')
  })
})

describe('employment type and preferences', () => {
  it('compares the posted arrangement with the ones the candidate accepts', () => {
    expect(compareRequirements(job({ employmentType: 'contractor' }), NO_REQUIREMENTS, candidate(), today).dimensions.employmentType.status).toBe('meets')
    expect(compareRequirements(job({ employmentType: 'employee' }), NO_REQUIREMENTS, candidate(), today).dimensions.employmentType.status).toBe('gap')
    expect(compareRequirements(job(), NO_REQUIREMENTS, candidate(), today).dimensions.employmentType.status).toBe('not_stated')
  })

  it('flags an excluded company or technology and notes a preferred one', () => {
    const prefs = candidate({ excludedCompanies: ['Globex Corporation'], excludedTech: ['PHP'], preferredTech: ['TypeScript'] })
    const result = compareRequirements(job({ companyName: 'Globex' }), requires({ skills: [skill('PHP'), skill('TypeScript', { importance: 'preferred' })] }), prefs, today)
    expect(result.dimensions.preferences.status).toBe('gap')
    expect(result.concerns.slice(0, 2)).toEqual(['Globex is on your excluded companies.', 'Uses PHP, which you excluded.'])
    expect(result.dimensions.preferences.findings).toContainEqual(expect.objectContaining({ requirement: 'Uses TypeScript', status: 'met' }))
  })
})

describe('a posting that could not be read', () => {
  it('leaves the requirement dimensions unknown and says so, while the structured ones still compare', () => {
    const result = compareRequirements(job({ seniority: 'senior' }), null, candidate(), today)
    for (const key of ['requiredSkills', 'preferredSkills', 'experience', 'languages'] as const) expect(result.dimensions[key].status).toBe('unknown')
    expect(result.dimensions.seniority.status).toBe('meets')
    expect(result.concerns).toContain('The posting’s requirements could not be read automatically.')
  })
})

describe('concerns', () => {
  it('lists the worst first and has no overall score', () => {
    const result = compareRequirements(
      job({ seniority: 'principal', salary: { source: 'posted', minMinor: 1_000_000, maxMinor: 2_000_000, currency: 'USD' } }),
      requires({ skills: [skill('Kubernetes')] }),
      candidate({ salaryFloorMinor: 6_000_000 }),
      today,
    )
    expect(result.concerns).toEqual([
      'Pays $10,000–$20,000, below your $60,000 floor.',
      'Missing required: Kubernetes.',
      'Principal role; you target senior.',
    ])
    expect(Object.keys(result)).not.toContain('score')
  })
})
