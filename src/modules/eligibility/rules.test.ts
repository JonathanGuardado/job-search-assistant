import { describe, expect, it, vi } from 'vitest'
import { assessEligibility, evaluateRules, validateQuotes } from './engine.js'
import { UNSPECIFIED_CLAIMS } from './types.js'
import type { EligibilityClaims, EligibilityJob, EligibilityProfile } from './types.js'

/*
 * Milestone 1.6 rule changes (decision 0009). The candidate is the owner's shape:
 * El Salvador, remote only, no authorizations listed, location hard.
 */

const profile = (overrides: Partial<EligibilityProfile> = {}): EligibilityProfile => ({
  country: 'SV',
  timezone: 'America/El_Salvador',
  workAuthorizations: [],
  willingToRelocate: false,
  allowedRegions: ['worldwide', 'latam'],
  employmentTypes: ['contractor'],
  salaryFloorMinor: null,
  salaryCurrency: 'USD',
  hardConstraints: new Set(['location', 'authorization', 'relocation']),
  ...overrides,
})

const job = (overrides: Partial<EligibilityJob> = {}): EligibilityJob => ({
  id: 'job-1',
  title: 'Senior Engineer',
  locationText: null,
  description: 'We are hiring a senior engineer.',
  locationPolicy: 'remote',
  locationCountry: null,
  remoteCountries: null,
  salaryMinMinor: null,
  salaryMaxMinor: null,
  salaryCurrency: null,
  salarySource: 'unknown',
  ...overrides,
})

const claims = (overrides: Partial<EligibilityClaims> = {}): EligibilityClaims => ({ ...UNSPECIFIED_CLAIMS, ...overrides })
const scoped = (countries: string[]): Partial<EligibilityClaims> =>
  ({ remoteScope: { kind: 'countries', countries, quote: 'Remote within the listed countries.' } })
const verdictOf = (p: EligibilityProfile, c: EligibilityClaims, j: EligibilityJob = job()) => evaluateRules(p, j, c, 'extracted')

describe('where the candidate can work comes from their settings (D8)', () => {
  it('accepts a region-scoped role when the candidate lives in that region', () => {
    const result = verdictOf(profile({ allowedRegions: [] }), claims({ remoteScope: { kind: 'regions', regions: ['latam'], quote: 'LATAM' } }))
    expect(result.verdict).toBe('eligible')
  })

  it('accepts a region the candidate selected even though they live elsewhere', () => {
    const result = verdictOf(profile({ allowedRegions: ['namer'] }), claims({ remoteScope: { kind: 'regions', regions: ['namer'], quote: 'North America' } }))
    expect(result.verdict).toBe('eligible')
  })

  it('accepts a country the candidate selected explicitly', () => {
    expect(verdictOf(profile({ allowedRegions: ['latam', 'ES'] }), claims(scoped(['ES']))).verdict).toBe('eligible')
  })

  it('does not treat a selected region as residence in every country of it', () => {
    // Selecting LATAM means "jobs open to LATAM", not "I can take a Colombia-only job".
    const result = verdictOf(profile(), claims(scoped(['CO', 'MX'])))
    expect(result).toMatchObject({ verdict: 'not_eligible', ruleId: 'remote-scope-excludes-country' })
  })

  it('rejects a region the candidate is neither in nor selected', () => {
    const result = verdictOf(profile(), claims({ remoteScope: { kind: 'regions', regions: ['emea'], quote: 'EMEA only' } }))
    expect(result.verdict).toBe('not_eligible')
  })

  it('never rejects on location when the setting is only preferred', () => {
    const result = verdictOf(profile({ hardConstraints: new Set(['authorization', 'relocation']) }), claims(scoped(['US'])))
    expect(result.verdict).toBe('eligible')
  })
})

describe('the candidate may always work in their own country (D5)', () => {
  it('satisfies an authorization requirement for the country they live in', () => {
    const result = verdictOf(profile(), claims({
      ...scoped(['SV']),
      authorization: { required: true, countries: ['SV'], sponsorshipOffered: false, quote: 'Must be authorized to work in El Salvador.' },
    }))
    expect(result.verdict).toBe('eligible')
  })
})

describe('onsite and hybrid roles name where they are (D3)', () => {
  it('rejects a hybrid role abroad with the sentence that places it', () => {
    const result = verdictOf(profile(), claims({ onsite: { kind: 'hybrid', countries: ['BR'], quote: 'Hybrid in São Paulo.' } }), job({ locationPolicy: 'unknown' }))
    expect(result).toMatchObject({ verdict: 'not_eligible', ruleId: 'onsite-requires-relocation', evidence: [{ quote: 'Hybrid in São Paulo.' }] })
  })

  it('accepts an onsite role when any of its countries is home', () => {
    const result = verdictOf(profile(), claims({ onsite: { kind: 'onsite', countries: ['CO', 'SV'], quote: 'Bogotá or San Salvador.' } }), job({ locationPolicy: 'unknown' }))
    expect(result.verdict).toBe('eligible')
  })

  it('prefers the countries the text names over the structured country', () => {
    const result = verdictOf(profile(), claims({ onsite: { kind: 'hybrid', countries: ['SV'], quote: 'Hybrid in San Salvador.' } }), job({ locationPolicy: 'hybrid', locationCountry: 'GT' }))
    expect(result.verdict).toBe('eligible')
  })
})

describe('a remote scope the candidate fits outranks office options (engine v2)', () => {
  // Real case (Canonical): "Home Based - Americas; Home Based - APAC; Office Based - Beijing,
  // China; Office Based - Taipei, Taiwan". The offices are options beside a remote role.
  const homeBasedWithOffices = (regions: Array<'latam' | 'namer' | 'apac'>) => claims({
    remoteScope: { kind: 'regions', regions, quote: 'Home Based - Americas; Home Based - APAC' },
    onsite: { kind: 'hybrid', countries: ['CN', 'TW'], quote: 'Office Based - Beijing, China; Office Based - Taipei, Taiwan' },
  })

  it('does not reject a remote role you fit because offices abroad are also listed', () => {
    expect(verdictOf(profile(), homeBasedWithOffices(['latam', 'namer', 'apac']), job({ locationPolicy: 'remote' })).verdict).toBe('eligible')
  })

  it('implies no authorization requirement for those offices either', () => {
    const relocating = profile({ willingToRelocate: true })
    expect(verdictOf(relocating, homeBasedWithOffices(['latam', 'namer', 'apac']), job({ locationPolicy: 'remote' })).verdict).toBe('eligible')
  })

  it('leaves the office requirement in force when the remote scope does not include you', () => {
    const result = verdictOf(profile(), homeBasedWithOffices(['apac']), job({ locationPolicy: 'remote' }))
    expect(result.verdict).toBe('not_eligible')
  })
})

describe('a worldwide claim the role\'s own location line does not support is an open question (engine v5)', () => {
  // Real cases (2026-11-10): Supabase "Remote, EMEA" with "We hire globally."; Lyft's hybrid
  // Seattle role with "work from anywhere for up to 4 weeks per year". Company wording and
  // perks were read as the role's scope.
  const worldwide = (quote: string, onsite: EligibilityClaims['onsite'] = { kind: 'remote', quote: 'Fully Remote' }) =>
    claims({ remoteScope: { kind: 'worldwide', quote }, onsite })
  const at = (locationText: string | null, title = 'Senior Engineer') => job({ locationText, title })
  const hybridUs: EligibilityClaims['onsite'] = { kind: 'hybrid', countries: ['US'], quote: 'work in the office 3 days per week' }

  it('asks when company wording says worldwide but the location line names somewhere else', () => {
    const result = verdictOf(profile(), worldwide('We hire globally.'), at('Remote, EMEA'))
    expect(result.verdict).toBe('needs_review')
    if (result.verdict !== 'needs_review') return
    expect(result.unresolvedRules).toContain('remote-scope-excludes-country')
    expect(result.openQuestions.join(' ')).toContain('Remote, EMEA')
  })

  it('asks, never rejects, when a travel perk sits beside a hybrid office abroad', () => {
    const result = verdictOf(profile(), worldwide('work from anywhere for up to 4 weeks per year', hybridUs), at('Seattle, WA'))
    expect(result.verdict).toBe('needs_review')
  })

  it('asks when the location line names no place but the text states office work', () => {
    expect(verdictOf(profile(), worldwide('work from anywhere for up to 4 weeks per year', hybridUs), at(null)).verdict).toBe('needs_review')
  })

  it('does not infer an authorization requirement from the contested office work', () => {
    const refused = claims({
      remoteScope: { kind: 'worldwide', quote: 'work from anywhere for up to 4 weeks per year' }, onsite: hybridUs,
      authorization: { required: 'unspecified', sponsorshipOffered: false, quote: 'We do not sponsor visas.' },
    })
    expect(verdictOf(profile({ willingToRelocate: true }), refused, at('Chicago')).verdict).toBe('needs_review')
  })

  it('still rejects on a stated authorization requirement with sponsorship refused', () => {
    const stated = claims({
      remoteScope: { kind: 'worldwide', quote: 'work from anywhere for up to 4 weeks per year' }, onsite: hybridUs,
      authorization: { required: true, countries: ['US'], sponsorshipOffered: false, quote: 'without the need for new visa sponsorship' },
    })
    expect(verdictOf(profile({ willingToRelocate: true }), stated, at('Chicago')).verdict).toBe('not_eligible')
  })

  it('trusts a worldwide statement made by the location line or the title', () => {
    const taipei = worldwide('Home based - Worldwide', { kind: 'hybrid', countries: ['TW'], quote: 'Office Based - Taipei, Taiwan' })
    expect(verdictOf(profile(), taipei, at('Home based - Worldwide; Office Based - Taipei, Taiwan')).verdict).toBe('eligible')
    expect(verdictOf(profile(), worldwide('Remote, Worldwide'), at('London', 'Senior Engineer (Remote, Worldwide)')).verdict).toBe('eligible')
  })

  it('trusts it when the location line includes the candidate: everywhere, their region, or their country', () => {
    const anywhere = worldwide('you can be located anywhere in the world')
    expect(verdictOf(profile(), anywhere, at('Americas; Sao Paulo; Buenos Aires; Montevideo')).verdict).toBe('eligible')
    expect(verdictOf(profile(), anywhere, at('NAMER and LatAm')).verdict).toBe('eligible')
    expect(verdictOf(profile(), anywhere, at('Anywhere; United States')).verdict).toBe('eligible')
    expect(verdictOf(profile(), anywhere, at('San Salvador, El Salvador')).verdict).toBe('eligible')
    expect(verdictOf(profile({ country: 'US', allowedRegions: ['namer'] }), anywhere, at('Remote, US')).verdict).toBe('eligible')
  })

  it('trusts it when the location line names no place at all', () => {
    expect(verdictOf(profile(), worldwide('We hire globally.'), at('Remote')).verdict).toBe('eligible')
    expect(verdictOf(profile(), worldwide('We hire globally.'), at(null)).verdict).toBe('eligible')
  })
})

describe('onsite abroad implies a work authorization requirement (D4)', () => {
  const relocating = profile({ willingToRelocate: true })
  const inIreland = (authorization: EligibilityClaims['authorization']) =>
    claims({ onsite: { kind: 'onsite', countries: ['IE'], quote: 'Based in Dublin.' }, authorization })

  it('asks about sponsorship when the posting is silent on it', () => {
    const result = verdictOf(relocating, inIreland({ required: 'unspecified' }), job({ locationPolicy: 'unknown' }))
    expect(result).toMatchObject({ verdict: 'needs_review', openQuestions: [expect.stringContaining('sponsor')] })
  })

  it('accepts when the posting offers sponsorship', () => {
    const result = verdictOf(relocating, inIreland({ required: 'unspecified', sponsorshipOffered: true, quote: 'We sponsor visas.' }), job({ locationPolicy: 'unknown' }))
    expect(result.verdict).toBe('eligible')
  })

  it('rejects, quoting the refusal, when the posting refuses sponsorship', () => {
    const result = verdictOf(relocating, inIreland({ required: 'unspecified', sponsorshipOffered: false, quote: 'We do not offer visa sponsorship.' }), job({ locationPolicy: 'unknown' }))
    expect(result).toMatchObject({ verdict: 'not_eligible', ruleId: 'authorization-missing', evidence: [{ quote: 'We do not offer visa sponsorship.' }] })
  })

  it('implies nothing for a remote role or an onsite role at home', () => {
    expect(verdictOf(relocating, claims({ ...scoped(['SV']), onsite: { kind: 'remote', quote: 'Remote.' } })).verdict).toBe('eligible')
    expect(verdictOf(relocating, claims({ onsite: { kind: 'onsite', countries: ['SV'], quote: 'San Salvador office.' } }), job({ locationPolicy: 'unknown' })).verdict).toBe('eligible')
  })

  it('accepts a candidate who already holds authorization there', () => {
    const authorized = profile({ willingToRelocate: true, workAuthorizations: [{ country: 'IE', type: 'stamp 4' }] })
    expect(verdictOf(authorized, inIreland({ required: 'unspecified' }), job({ locationPolicy: 'unknown' })).verdict).toBe('eligible')
  })
})

describe('quotes may come from the title and location line', () => {
  it('keeps a scope claim quoted from the location line', () => {
    const posting = job({ title: 'Account Executive - US-Based', locationText: 'Remote, United States', description: 'Sell things.' })
    const { claims: kept, stripped } = validateQuotes(claims({ remoteScope: { kind: 'countries', countries: ['US'], quote: 'Remote, United States' } }), posting)
    expect(stripped).toBe(0)
    expect(kept.remoteScope.kind).toBe('countries')
  })

  it('treats a claim the model did not quote as unspecified', () => {
    // A real extraction: regions with no quote, which the model had added from working hours.
    const { claims: kept, stripped, unquoted } = validateQuotes(claims({
      remoteScope: { kind: 'regions', regions: ['latam', 'namer'] },
      authorization: { required: 'unspecified', sponsorshipOffered: false },
    }), job())
    expect({ stripped, unquoted }).toEqual({ stripped: 0, unquoted: 2 })
    expect(kept.remoteScope).toEqual({ kind: 'unspecified' })
    expect(kept.authorization).toEqual({ required: 'unspecified' })
  })

  it('leaves unspecified claims alone, quote or not', () => {
    expect(validateQuotes(claims(), job())).toMatchObject({ stripped: 0, unquoted: 0 })
  })

  it('still strips a quote found nowhere in the posting', () => {
    const { claims: kept, stripped } = validateQuotes(claims({ remoteScope: { kind: 'worldwide', quote: 'Work from anywhere on Earth.' } }), job())
    expect(stripped).toBe(1)
    expect(kept.remoteScope.kind).toBe('unspecified')
  })
})

describe('stage 1 can only reject (D1)', () => {
  it('reads the posting even when structured fields raise no objection', async () => {
    const extract = vi.fn(async () => claims())
    const result = await assessEligibility(profile(), job({ locationPolicy: 'onsite', locationCountry: 'SV' }), extract)
    expect(extract).toHaveBeenCalledOnce()
    expect(result.stage).toBe('extracted')
  })

  it('rejects from structured fields without a model call', async () => {
    const extract = vi.fn(async () => claims())
    const result = await assessEligibility(profile(), job({ locationPolicy: 'hybrid', locationCountry: 'MT' }), extract)
    expect(extract).not.toHaveBeenCalled()
    expect(result).toMatchObject({ stage: 'structured', verdict: { verdict: 'not_eligible', ruleId: 'onsite-requires-relocation' } })
  })
})

describe("the source's country list stands in for a scope the text never states (engine v6, decision 0017)", () => {
  const listed = (remoteCountries: string[] | null, overrides: Partial<EligibilityJob> = {}) => job({ remoteCountries, ...overrides })

  it('accepts a role the text is silent on when the list includes the candidate\'s country, and stores the list', () => {
    const result = verdictOf(profile(), claims(), listed(['US', 'SV', 'MX']))
    expect(result).toMatchObject({
      verdict: 'eligible',
      evidence: [{ ruleId: 'remote-scope-excludes-country', sourceCountries: ['US', 'SV', 'MX'] }],
    })
  })

  it('accepts a country the candidate selected', () => {
    expect(verdictOf(profile({ allowedRegions: ['ES'] }), claims(), listed(['ES', 'PT'])).verdict).toBe('eligible')
  })

  it('does not treat a selected region as residence in a listed country of it', () => {
    const result = verdictOf(profile(), claims(), listed(['CO', 'MX']))
    expect(result.verdict).toBe('needs_review')
  })

  it('never rejects on the list: a list without the candidate is an open question, at either stage', () => {
    for (const stage of ['structured', 'extracted'] as const) {
      const result = evaluateRules(profile(), listed(['US', 'CA']), claims(), stage)
      expect(result).toMatchObject({ verdict: 'needs_review', unresolvedRules: ['remote-scope-excludes-country'] })
      if (result.verdict === 'needs_review') expect(result.openQuestions[0]).toContain('job board lists this role for US, CA')
    }
  })

  it('names a long list by its size', () => {
    const many = ['AR', 'BO', 'BR', 'CL', 'CO', 'CR', 'MX', 'PE']
    const result = verdictOf(profile(), claims(), listed(many))
    if (result.verdict !== 'needs_review') throw new Error('expected needs_review')
    expect(result.openQuestions[0]).toContain('8 countries')
  })

  it('rejects on a stated scope that excludes the candidate when the list leaves them out too', () => {
    const usOnly = claims({ remoteScope: { kind: 'countries', countries: ['US'], quote: 'U.S. Based' } })
    for (const list of [['US', 'CA'], null]) {
      expect(verdictOf(profile(), usOnly, listed(list)))
        .toMatchObject({ verdict: 'not_eligible', ruleId: 'remote-scope-excludes-country', evidence: [{ quote: 'U.S. Based' }] })
    }
  })

  // The model misreads long place lists ("Canada, Latin America, or Ukraine" → CA, UA): a second reading that disagrees is a question.
  it('asks instead of rejecting when the stated scope excludes the candidate but the list includes them', () => {
    const misread = claims({ remoteScope: { kind: 'countries', countries: ['CA', 'UA'], quote: 'work from Canada, Latin America, or Ukraine' } })
    const result = verdictOf(profile(), misread, listed(['CA', 'UA', 'SV', 'MX']))
    expect(result).toMatchObject({ verdict: 'needs_review', unresolvedRules: ['remote-scope-excludes-country'] })
    if (result.verdict === 'needs_review') expect(result.openQuestions).toEqual([
      'The posting says "work from Canada, Latin America, or Ukraine", which leaves out where you can work, but the job board lists the role as open there.',
    ])
    const europe = claims({ remoteScope: { kind: 'regions', regions: ['emea'], quote: 'Remote in Europe' } })
    expect(verdictOf(profile(), europe, listed(['DE', 'SV'])).verdict).toBe('needs_review')
    expect(verdictOf(profile(), europe, listed(['DE', 'FR'])).verdict).toBe('not_eligible')
  })

  it('lets the text win when it states a scope that includes the candidate', () => {
    const result = verdictOf(profile(), claims({ remoteScope: { kind: 'regions', regions: ['latam'], quote: 'Remote in LATAM' } }), listed(['US', 'CA']))
    expect(result).toMatchObject({ verdict: 'eligible', evidence: [] })
  })

  it('treats a missing or empty list as silence, never as worldwide', () => {
    for (const none of [null, []]) {
      const result = verdictOf(profile(), claims(), listed(none))
      expect(result).toMatchObject({ verdict: 'needs_review', openQuestions: ['The posting says remote but does not say which countries it accepts.'] })
    }
  })

  it('compares codes whatever their case', () => {
    expect(verdictOf(profile(), claims(), listed(['sv'])).verdict).toBe('eligible')
  })

  it('asks instead of rejecting when the text describes office work abroad but the list includes the candidate', () => {
    const office = claims({ onsite: { kind: 'hybrid', countries: ['GB'], quote: 'three days a week in our London office' } })
    const result = verdictOf(profile(), office, listed(['GB', 'SV']))
    expect(result).toMatchObject({ verdict: 'needs_review', unresolvedRules: ['onsite-requires-relocation'] })
    if (result.verdict === 'needs_review') expect(result.openQuestions).toEqual([
      'The posting describes hybrid work in GB, but the job board lists the role as open to remote workers where you are.',
    ])
  })

  it('still rejects office work abroad when the list does not include the candidate', () => {
    const office = claims({ onsite: { kind: 'hybrid', countries: ['GB'], quote: 'three days a week in our London office' } })
    expect(verdictOf(profile(), office, listed(['GB', 'IE']))).toMatchObject({ verdict: 'not_eligible', ruleId: 'onsite-requires-relocation' })
  })

  // Job boards expand "North America" to the continent (UN M49): Northern America, Mexico, Central America, the Caribbean.
  const northAmerica = ['AI', 'AG', 'AW', 'BS', 'BB', 'BZ', 'BM', 'BQ', 'CA', 'KY', 'CR', 'CU', 'CW', 'DM', 'DO', 'SV', 'GL', 'GD', 'GP', 'GT', 'HT',
    'HN', 'JM', 'MQ', 'MX', 'MS', 'NI', 'PA', 'PR', 'BL', 'KN', 'LC', 'MF', 'PM', 'VC', 'SX', 'TT', 'TC', 'US', 'UM', 'VG', 'VI']
  const southAmerica = ['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'PY', 'PE', 'UY', 'VE']

  it('does not take a "North America" list as naming Central America: employers usually mean the US and Canada', () => {
    const result = verdictOf(profile(), claims(), listed(northAmerica))
    expect(result).toMatchObject({ verdict: 'needs_review', unresolvedRules: ['remote-scope-excludes-country'] })
    if (result.verdict === 'needs_review') expect(result.openQuestions).toEqual([
      'The job board lists this role for North America, which it stretches to Central America and the Caribbean; employers usually mean the United States and Canada. The posting itself does not say where it hires.',
    ])
  })

  it('still takes a "North America" list as naming the US and Canada, with other regions listed beside it', () => {
    const inNewYork = profile({ country: 'US', allowedRegions: [] })
    expect(verdictOf(inNewYork, claims(), listed(northAmerica)).verdict).toBe('eligible')
    expect(verdictOf(profile({ country: 'DE', allowedRegions: [] }), claims(), listed([...northAmerica, 'DE', 'FR'])).verdict).toBe('eligible')
    expect(verdictOf(profile(), claims(), listed([...northAmerica, 'DE', 'FR'])).verdict).toBe('needs_review')
  })

  it('takes the Americas, and a short list picked by hand, at their word', () => {
    expect(verdictOf(profile(), claims(), listed([...northAmerica, ...southAmerica])).verdict).toBe('eligible')
    expect(verdictOf(profile(), claims(), listed(['US', 'CA', 'MX', 'SV'])).verdict).toBe('eligible')
  })

  it('contests a worldwide claim from the description when the list leaves the candidate out, like a location line would (v5)', () => {
    const globally = claims({ remoteScope: { kind: 'worldwide', quote: 'globally distributed members' } })
    const text = { description: 'We are a team of 400+ globally distributed members.' }
    const result = verdictOf(profile(), globally, listed(northAmerica, text))
    expect(result).toMatchObject({ verdict: 'needs_review', unresolvedRules: ['remote-scope-excludes-country'] })
    if (result.verdict === 'needs_review') expect(result.openQuestions).toEqual([
      'The posting says "globally distributed members", but the job board lists it for North America: it does not say the role is open where you are.',
    ])
    expect(verdictOf(profile(), globally, listed(['US', 'GB'], text)).verdict).toBe('needs_review')
    // A list with the candidate in it, or no list, leaves the claim standing.
    expect(verdictOf(profile(), globally, listed(['US', 'SV'], text)).verdict).toBe('eligible')
    expect(verdictOf(profile(), globally, listed(null, text)).verdict).toBe('eligible')
  })

  it('lets a worldwide claim in the title stand against the list', () => {
    const titled = claims({ remoteScope: { kind: 'worldwide', quote: 'Remote (Worldwide)' } })
    expect(verdictOf(profile(), titled, listed(['US', 'GB'], { title: 'Engineer, Remote (Worldwide)' })).verdict).toBe('eligible')
  })

  it('does not let a "North America" list contradict a stated North America scope', () => {
    const stated = claims({ remoteScope: { kind: 'regions', regions: ['namer'], quote: 'open to any candidate in North America' } })
    expect(verdictOf(profile(), stated, listed(northAmerica))).toMatchObject({ verdict: 'not_eligible', ruleId: 'remote-scope-excludes-country' })
  })

  it('asks about office work abroad that the list contradicts, whatever scope the text states', () => {
    const office = claims({
      remoteScope: { kind: 'countries', countries: ['GB'], quote: 'UK only' },
      onsite: { kind: 'hybrid', countries: ['GB'], quote: 'three days a week in our London office' },
    })
    expect(verdictOf(profile(), office, listed(['GB', 'SV'])).verdict).toBe('needs_review')
    expect(verdictOf(profile(), office, listed(['GB', 'IE'])).verdict).toBe('not_eligible')
  })

  it('does not let a "North America" list contradict office work abroad', () => {
    const office = claims({ onsite: { kind: 'hybrid', countries: ['US'], quote: 'three days a week in our Austin office' } })
    expect(verdictOf(profile(), office, listed(northAmerica))).toMatchObject({ verdict: 'not_eligible', ruleId: 'onsite-requires-relocation' })
  })

  it('still rejects on a stated authorization requirement with sponsorship refused', () => {
    const auth = claims({ authorization: { required: true, countries: ['US'], sponsorshipOffered: false, quote: 'We do not sponsor visas.' } })
    expect(verdictOf(profile(), auth, listed(['US', 'SV']))).toMatchObject({ verdict: 'not_eligible', ruleId: 'authorization-missing' })
  })
})

describe('stage 1 and the source list (engine v6)', () => {
  it('reads the posting even when the list excludes the candidate: the list proves nothing', async () => {
    const extract = vi.fn(async () => claims({ remoteScope: { kind: 'worldwide', quote: 'Senior Engineer' } }))
    const result = await assessEligibility(profile(), job({ remoteCountries: ['US'] }), extract)
    expect(extract).toHaveBeenCalledOnce()
    expect(result.verdict.verdict).toBe('eligible')
  })
})
