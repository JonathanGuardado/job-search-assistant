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
