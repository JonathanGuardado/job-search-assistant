import { describe, expect, it } from 'vitest'
import { fingerprint, locationKey } from './fingerprint.js'
import { normalizeCompany } from './normalize-company.js'
import { normalizeTitle } from './normalize-title.js'

describe('normalizeCompany', () => {
  it.each([
    ['Acme, Inc.', 'acme'],
    ['Globex S.A. de C.V.', 'globex'],
    ['Nubank Ltda.', 'nubank'],
    ['Gusto, Inc.', 'gusto'],
    ['Bank of America Corp', 'bank of america'],
    ['Société Générale SA', 'societe generale'],
    ['Procter & Gamble Co.', 'procter and gamble'],
    ['Fixture Co', 'fixture'],
    ['Grafana Labs', 'grafana labs'],
    ['dLocal', 'dlocal'],
    ['Acme GmbH & Co. KG', 'acme'],
  ])('%s → %s', (name, expected) => {
    expect(normalizeCompany(name)).toBe(expected)
  })

  it('strips a suffix only at the end, never from the middle of a name', () => {
    expect(normalizeCompany('Co-Star Group')).toBe('co star group')
    expect(normalizeCompany('Inc Ventures')).toBe('inc ventures')
    expect(normalizeCompany('Casa de')).toBe('casa de')
  })

  it('treats a configured rename variant as the same company', () => {
    expect(normalizeCompany('Wellhub, Inc.')).toBe(normalizeCompany('Wellhub'))
  })

  it('never returns an empty string, even for a name that is only a suffix', () => {
    expect(normalizeCompany('Inc.')).toBe('inc')
  })
})

describe('normalizeTitle', () => {
  it.each([
    // Board decorations made only of work-arrangement and region words are removed.
    ['Senior Software Engineer II (Remote - LATAM)', 'software engineer ii', 'senior'],
    ['Account Executive - LATAM', 'account executive', null],
    ['International Growth Marketing Manager (Contract)', 'international growth marketing manager', null],
    ['Software Engineer (Full-Time, Remote)', 'software engineer', null],
    ['Legal & Compliance Expert - São Paulo (Hybrid)', 'legal and compliance expert sao paulo', null],
    ['Staff Technical Writer | Remote | Germany', 'technical writer germany', 'staff'],
    ['Site Reliability Engineer, Infrastructure Platforms — AMER', 'site reliability engineer infrastructure platforms', null],
    ['Technical Escalations Engineer II (RUM) - APJ', 'technical escalations engineer ii rum', null],
    // Qualifiers that name a team, product or place are part of the role and stay.
    ['Staff Software Engineer, Backend - FinHub (Transfers)', 'software engineer backend finhub transfers', 'staff'],
    ['Manager, Contract Management', 'manager contract management', null],
    ['Director, Global Sales', 'director global sales', null],
    ['Mid Market Account Executive - Benelux', 'mid market account executive benelux', null],
    // Seniority is read from leading words only.
    ['Sr Performance Analyst', 'performance analyst', 'senior'],
    ['Senior Staff Engineer', 'engineer', 'staff'],
    ['Principal Software Developer - Query Engine', 'software developer query engine', 'principal'],
    ['Lead Product Designer', 'product designer', 'lead'],
    ['Junior Data Analyst', 'data analyst', 'junior'],
    ['Internship - Software Engineering', 'software engineering', 'intern'],
    ['Chief of Staff', 'chief of staff', null],
    // Level numerals are part of the role: Brex posts "Sourcer" and "Sourcer II" as different jobs.
    ['Engineer I', 'engineer i', null],
    ['Senior Technical Sourcer II', 'technical sourcer ii', 'senior'],
  ])('%s → "%s" (%s)', (title, titleNormalized, seniority) => {
    expect(normalizeTitle(title)).toEqual({ titleNormalized, seniority })
  })

  it('falls back to the cleaned title rather than returning an empty one', () => {
    expect(normalizeTitle('Senior')).toEqual({ titleNormalized: 'senior', seniority: 'senior' })
    expect(normalizeTitle('(Remote)')).toEqual({ titleNormalized: 'remote', seniority: null })
  })
})

describe('locationKey', () => {
  it('ignores the order of ;-separated locations, case, accents and spacing', () => {
    expect(locationKey('California, USA, Remote; New York, USA, Remote'))
      .toBe(locationKey('new york,  USA, remote;California, USA, Remote'))
    expect(locationKey('São Paulo')).toBe(locationKey('Sao Paulo'))
  })

  it('keeps different locations apart', () => {
    expect(locationKey('Chile, Remote')).not.toBe(locationKey('Texas, USA, Remote'))
  })

  it('maps a missing location to the empty key', () => {
    expect(locationKey(null)).toBe('')
  })
})

describe('fingerprint', () => {
  const base = {
    companyNormalized: 'datadog', titleNormalized: 'account executive', seniority: null, locationPolicy: 'remote',
    locationKey: 'chile remote', description: 'Sell to enterprises across LATAM. Requisition 3273525921.',
  } as const

  it('is a stable sha256 hex digest', () => {
    expect(fingerprint(base)).toMatch(/^[a-f0-9]{64}$/)
    expect(fingerprint(base)).toBe(fingerprint({ ...base }))
  })

  it('changes when any component changes', () => {
    const variants = [
      { ...base, companyNormalized: 'mongodb' },
      { ...base, titleNormalized: 'solutions engineer' },
      // Elastic posts Senior and Principal versions of one title with templated text: different jobs.
      { ...base, seniority: 'principal' },
      { ...base, locationPolicy: 'unknown' },
      { ...base, locationKey: 'texas usa remote' },
    ] as const
    for (const variant of variants) expect(fingerprint(variant)).not.toBe(fingerprint(base))
  })

  it('cannot be forged by moving text between components', () => {
    expect(fingerprint({ ...base, companyNormalized: 'a|b', titleNormalized: 'c' }))
      .not.toBe(fingerprint({ ...base, companyNormalized: 'a', titleNormalized: 'b|c' }))
  })

  it('ignores case, punctuation, whitespace and long identifiers in the description', () => {
    expect(fingerprint({ ...base, description: 'sell to ENTERPRISES   across latam — requisition 3273525928' })).toBe(fingerprint(base))
  })

  // Real near-duplicates whose one difference is material (decision 0008).
  it.each([
    ['working hours', 'Overlap with Pacific time, 8am to 5pm PT.', 'Overlap with Eastern time, 8am to 5pm PT.'],
    ['years of experience', 'You have 3+ years of experience.', 'You have 5+ years of experience.'],
    ['schedule', 'Shifts run Tuesday to Saturday.', 'Shifts run Sunday to Thursday.'],
  ])('keeps postings apart when only the %s differ', (_label, a, b) => {
    expect(fingerprint({ ...base, description: a })).not.toBe(fingerprint({ ...base, description: b }))
  })
})
