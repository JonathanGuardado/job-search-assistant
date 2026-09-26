import { describe, expect, it } from 'vitest'
import { evaluateRules, validateQuotes } from './engine.js'
import { UNSPECIFIED_CLAIMS } from './types.js'
import type { EligibilityClaims, EligibilityJob, EligibilityProfile } from './types.js'

const profile = (overrides: Partial<EligibilityProfile> = {}): EligibilityProfile => ({
  country: 'SV',
  timezone: 'America/El_Salvador',
  workAuthorizations: [{ country: 'SV', type: 'citizen' }],
  willingToRelocate: false,
  allowedRegions: ['worldwide', 'latam'],
  employmentTypes: ['employee', 'contractor'],
  salaryFloorMinor: 8_000_000,
  salaryCurrency: 'USD',
  hardConstraints: new Set(['location', 'authorization', 'relocation']),
  ...overrides,
})

const job = (overrides: Partial<EligibilityJob> = {}): EligibilityJob => ({
  id: 'job-1',
  description: 'We are hiring a senior engineer.',
  locationPolicy: 'remote',
  locationCountry: null,
  salaryMinMinor: null,
  salaryMaxMinor: null,
  salaryCurrency: null,
  salarySource: 'unknown',
  ...overrides,
})

const claims = (overrides: Partial<EligibilityClaims> = {}): EligibilityClaims => ({
  ...UNSPECIFIED_CLAIMS,
  ...overrides,
})

describe('the third state', () => {
  it('returns needs_review for a bare remote posting', () => {
    const result = evaluateRules(profile(), job(), claims(), 'extracted')
    expect(result.verdict).toBe('needs_review')
  })

  it('never rejects without a supporting quote at the extracted stage', () => {
    const result = evaluateRules(
      profile(),
      job(),
      claims({ remoteScope: { kind: 'countries', countries: ['US'] } }),
      'extracted',
    )
    expect(result.verdict).toBe('needs_review')
  })

  it('rejects with a quote', () => {
    const result = evaluateRules(
      profile(),
      job(),
      claims({
        remoteScope: {
          kind: 'countries',
          countries: ['US'],
          quote: 'This role is open to US residents only.',
        },
      }),
      'extracted',
    )
    expect(result.verdict).toBe('not_eligible')
    if (result.verdict === 'not_eligible') {
      expect(result.ruleId).toBe('remote-scope-excludes-country')
      expect(result.evidence[0]?.quote).toContain('US residents only')
    }
  })
})

describe('the US-only trap', () => {
  it('does not reject on an authorization requirement when sponsorship is unstated', () => {
    const result = evaluateRules(
      profile(),
      job(),
      claims({
        authorization: {
          required: true,
          countries: ['US'],
          quote: 'Must be authorized to work in the US.',
        },
      }),
      'extracted',
    )
    // Uncertain, not a rejection — an EOR or visa may satisfy this.
    expect(result.verdict).toBe('needs_review')
  })

  it('rejects only when sponsorship is explicitly refused', () => {
    const result = evaluateRules(
      profile(),
      job(),
      claims({
        authorization: {
          required: true,
          countries: ['US'],
          sponsorshipOffered: false,
          quote: 'We cannot sponsor visas.',
        },
      }),
      'extracted',
    )
    expect(result.verdict).toBe('not_eligible')
  })
})

describe('regions', () => {
  it('accepts a LATAM-scoped role for a candidate in El Salvador', () => {
    const result = evaluateRules(
      profile(),
      job(),
      claims({ remoteScope: { kind: 'regions', regions: ['latam'], quote: 'LATAM only.' } }),
      'extracted',
    )
    expect(result.verdict).toBe('eligible')
  })

  it('rejects an EMEA-scoped role with a quote', () => {
    const result = evaluateRules(
      profile(),
      job(),
      claims({ remoteScope: { kind: 'regions', regions: ['emea'], quote: 'EMEA only.' } }),
      'extracted',
    )
    expect(result.verdict).toBe('not_eligible')
  })

  it('accepts worldwide', () => {
    const result = evaluateRules(
      profile(),
      job(),
      claims({ remoteScope: { kind: 'worldwide', quote: 'Hiring worldwide.' } }),
      'extracted',
    )
    expect(result.verdict).toBe('eligible')
  })
})

describe('preferences never reject', () => {
  it('ignores a salary below floor when salary is not a hard constraint', () => {
    const result = evaluateRules(
      profile({ hardConstraints: new Set(['location']) }),
      job({
        salaryMaxMinor: 5_000_000,
        salaryCurrency: 'USD',
        salarySource: 'posted',
      }),
      claims({ remoteScope: { kind: 'worldwide', quote: 'Hiring worldwide.' } }),
      'extracted',
    )
    expect(result.verdict).toBe('eligible')
  })

  it('rejects a salary below floor when salary is hard', () => {
    const result = evaluateRules(
      profile({ hardConstraints: new Set(['location', 'salary']) }),
      job({
        salaryMaxMinor: 5_000_000,
        salaryCurrency: 'USD',
        salarySource: 'posted',
      }),
      claims({ remoteScope: { kind: 'worldwide', quote: 'Hiring worldwide.' } }),
      'structured',
    )
    expect(result.verdict).toBe('not_eligible')
  })

  it('never rejects on an unstated salary', () => {
    const result = evaluateRules(
      profile({ hardConstraints: new Set(['location', 'salary']) }),
      job({ salarySource: 'unknown' }),
      claims({ remoteScope: { kind: 'worldwide', quote: 'Hiring worldwide.' } }),
      'structured',
    )
    expect(result.verdict).toBe('eligible')
  })
})

describe('quote validation', () => {
  const source = 'This role is open to candidates in LATAM. We cannot sponsor visas.'

  it('keeps a claim whose quote appears verbatim', () => {
    const { claims: sanitized, stripped } = validateQuotes(
      claims({
        remoteScope: {
          kind: 'regions',
          regions: ['latam'],
          quote: 'open to candidates in LATAM',
        },
      }),
      source,
    )
    expect(stripped).toBe(0)
    expect(sanitized.remoteScope.kind).toBe('regions')
  })

  it('strips a fabricated quote back to unspecified', () => {
    const { claims: sanitized, stripped } = validateQuotes(
      claims({
        remoteScope: {
          kind: 'countries',
          countries: ['US'],
          quote: 'US residents only',
        },
      }),
      source,
    )
    expect(stripped).toBe(1)
    expect(sanitized.remoteScope.kind).toBe('unspecified')
  })

  it('tolerates whitespace differences', () => {
    const { stripped } = validateQuotes(
      claims({
        relocation: { required: true, quote: 'We  cannot\nsponsor   visas.' },
      }),
      source,
    )
    expect(stripped).toBe(0)
  })
})

describe('onsite', () => {
  it('rejects an onsite role abroad for a candidate who will not relocate', () => {
    const result = evaluateRules(
      profile(),
      job({ locationPolicy: 'onsite', locationCountry: 'DE' }),
      claims(),
      'structured',
    )
    expect(result.verdict).toBe('not_eligible')
  })

  it('accepts an onsite role abroad when the candidate will relocate', () => {
    const result = evaluateRules(
      profile({ willingToRelocate: true }),
      job({ locationPolicy: 'onsite', locationCountry: 'DE' }),
      claims(),
      'structured',
    )
    expect(result.verdict).toBe('eligible')
  })
})
