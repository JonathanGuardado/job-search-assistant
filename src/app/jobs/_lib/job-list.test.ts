import { describe, expect, it } from 'vitest'
import { REVIEW_GROUPS, type Assessment } from '@/modules/eligibility'
import type { Job, JobUserState } from '@/modules/jobs'
import type { Dimension, DimensionStatus, Match } from '@/modules/matching'
import { buildJobList, type JobListInput, type JobTab } from './job-list'

const now = new Date('2026-10-22T12:00:00Z')
const userId = '00000000-0000-4000-8000-000000000001'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function job(n: number, overrides: Partial<Job> = {}): Job {
  return {
    id: id(n), sourceId: id(900), externalId: String(n), canonicalJobId: null,
    companyName: 'Example Company', companyNormalized: 'example company', title: 'Engineer', titleNormalized: 'engineer',
    seniority: null, description: 'Posting text', locationPolicy: 'remote', locationText: null, locationCountry: null,
    employmentType: 'unknown', salary: { source: 'unknown' }, salaryQuote: null, applyUrl: 'https://example.com/jobs',
    postedAt: now, fingerprint: 'fingerprint', firstSeenAt: now, lastSeenAt: now, closedAt: null, ...overrides,
  }
}

function assessment(n: number, overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: id(n + 1000), userId, jobId: id(n), engineVersion: 4, verdict: 'eligible', confidence: 1,
    stage: 'extracted', reasons: {}, evidence: [], claimsId: null, promptVersion: null, model: null,
    jobFingerprint: 'fingerprint', profileHash: 'profile', assessedAt: now, userOverride: null, overrideReason: null, ...overrides,
  }
}

function match(n: number, role: DimensionStatus = 'meets'): Match {
  const none: Dimension = { status: 'not_stated', findings: [] }
  return {
    id: id(n + 2000), userId, jobId: id(n), engineVersion: 4,
    dimensions: {
      requiredSkills: none, preferredSkills: none, experience: none, languages: none, role: { status: role, findings: [] },
      seniority: none, salary: none, employmentType: none, preferences: none,
    },
    metRequirements: [], missingRequirements: [], concerns: [], salaryCompatibility: 'unknown',
    requirementsId: null, promptVersion: null, model: null, jobFingerprint: 'fingerprint', inputsHash: 'inputs', assessedAt: now,
  }
}

const rejection: Pick<Assessment, 'verdict' | 'reasons'> = {
  verdict: 'not_eligible', reasons: { ruleId: 'remote-scope-excludes-country', reason: 'US only.' },
}

function list(input: Partial<JobListInput> = {}) {
  return buildJobList({ assessments: [], jobs: [], matches: [], userStates: [], tab: 'can_apply', page: 1, company: '', ...input })
}

describe('buildJobList', () => {
  it('uses all five review groups and lets an override decide the group', () => {
    const assessments = [
      assessment(1),
      assessment(2, { verdict: 'needs_review', reasons: { openQuestions: ['Remote scope?'] } }),
      assessment(3, { verdict: 'needs_review', reasons: { openQuestions: ['Remote or onsite?'], isLocationOnly: true } }),
      assessment(4, { verdict: 'needs_review', reasons: { openQuestions: ['Visa sponsorship?'], unresolvedRules: ['authorization-missing'] } }),
      assessment(5, rejection),
      assessment(6, { ...rejection, userOverride: 'eligible' }),
    ]
    const jobs = assessments.map((_, i) => job(i + 1))
    const expected: Record<JobTab, string[]> = {
      can_apply: [id(1), id(6)], needs_review: [id(2)], location_only: [id(3)], visa_unknown: [id(4)], not_eligible: [id(5)], hidden: [],
    }
    const result = list({ jobs, assessments })
    expect(result.tabs.map((tab) => tab.key)).toEqual([...REVIEW_GROUPS, 'hidden'])
    expect(result.tabs.map((tab) => tab.label)).toEqual(['Can apply', 'Needs review', 'Probably onsite', 'Needs a visa', 'Not eligible', 'Hidden'])
    for (const tab of result.tabs) {
      expect(tab.count).toBe(expected[tab.key].length)
      expect(list({ jobs, assessments, tab: tab.key }).rows.map((row) => row.job.id)).toEqual(expected[tab.key])
    }
  })

  it('puts ignored jobs exclusively in Hidden, and keeps saved and applied jobs visible', () => {
    const userStates: JobUserState[] = [
      { userId, jobId: id(1), state: 'ignored', updatedAt: now },
      { userId, jobId: id(2), state: 'saved', updatedAt: now },
      { userId, jobId: id(3), state: 'applied', updatedAt: now },
    ]
    const input = { jobs: [job(1), job(2), job(3)], assessments: [assessment(1), assessment(2), assessment(3)], userStates }
    const result = list(input)
    expect(result.tabs.map((tab) => tab.count)).toEqual([2, 0, 0, 0, 0, 1])
    expect(result.rows.map((row) => row.job.id)).toEqual([id(2), id(3)])
    const hidden = list({ ...input, tab: 'hidden' })
    expect(hidden.rows.map((row) => row.job.id)).toEqual([id(1)])
    expect(hidden.rows[0]?.userState?.state).toBe('ignored')
  })

  it('excludes closed jobs, linked duplicates and jobs with no assessment from every tab', () => {
    const input = {
      jobs: [job(1, { closedAt: now }), job(2, { canonicalJobId: id(1) }), job(3)],
      assessments: [assessment(1), assessment(2), assessment(4)],
    }
    for (const tab of list(input).tabs) {
      expect(tab.count).toBe(0)
      expect(list({ ...input, tab: tab.key }).rows).toEqual([])
    }
  })

  it('counts before filtering and trims a case-insensitive company substring', () => {
    const input = { jobs: [job(1, { companyName: 'Acme Inc' }), job(2, { companyName: 'Other' })], assessments: [assessment(1), assessment(2)] }
    const result = list({ ...input, company: '  CME  ' })
    expect(result.tabs[0]?.count).toBe(2)
    expect(result.rows.map((row) => row.job.id)).toEqual([id(1)])
    expect(list({ ...input, company: '   ' }).rows).toHaveLength(2)
  })

  it('orders role meets before partial before unmatched, regardless of posting date', () => {
    const result = list({
      jobs: [job(1), job(2), job(3, { postedAt: null })], assessments: [assessment(1), assessment(2), assessment(3)],
      matches: [match(2, 'partial'), match(3, 'meets')],
    })
    expect(result.rows.map((row) => row.job.id)).toEqual([id(3), id(2), id(1)])
    expect(result.rows[0]?.match?.jobId).toBe(id(3))
    expect(result.rows[2]?.match).toBeNull()
  })

  it('breaks match ties by newest posting, then null last, then job id', () => {
    const result = list({
      jobs: [job(4, { postedAt: null }), job(3), job(2), job(1, { postedAt: new Date('2025-01-01T00:00:00Z') })],
      assessments: [1, 2, 3, 4].map((n) => assessment(n)), matches: [1, 2, 3, 4].map((n) => match(n)),
    })
    expect(result.rows.map((row) => row.job.id)).toEqual([id(2), id(3), id(1), id(4)])
  })

  it('pages at 50 rows and clamps a page beyond the end', () => {
    const input = { jobs: Array.from({ length: 51 }, (_, i) => job(i + 1)), assessments: Array.from({ length: 51 }, (_, i) => assessment(i + 1)) }
    expect(list(input).rows).toHaveLength(50)
    const second = list({ ...input, page: 2 })
    expect(second.pageCount).toBe(2)
    expect(second.rows.map((row) => row.job.id)).toEqual([id(51)])
    expect(list({ ...input, page: 99 })).toEqual(second)
    expect(list({ ...input, company: 'missing', page: 99 })).toMatchObject({ page: 1, pageCount: 1, rows: [] })
  })

  it('has one page and no rows for an empty tab', () => {
    expect(list({ tab: 'hidden', page: 99 })).toMatchObject({ page: 1, pageCount: 1, rows: [] })
  })
})
