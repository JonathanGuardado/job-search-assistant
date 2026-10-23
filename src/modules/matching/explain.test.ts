import { describe, expect, it } from 'vitest'
import { compareRequirements } from './compare.js'
import { explainMatch } from './explain.js'
import { NO_REQUIREMENTS } from './types.js'

const today = new Date('2026-10-15T00:00:00Z')

describe('explainMatch', () => {
  it('turns each dimension with something to say into a headline and its evidence lines', () => {
    const result = compareRequirements(
      { title: 'Senior Backend Engineer', companyName: 'Globex', seniority: 'senior', employmentType: 'unknown', salary: { source: 'unknown' } },
      {
        ...NO_REQUIREMENTS,
        skills: [
          { name: 'TypeScript', importance: 'required', minYears: null, quote: 'Strong TypeScript' },
          { name: 'Kubernetes', importance: 'required', minYears: null, quote: 'Deep knowledge of Kubernetes' },
        ],
        other: [{ text: "Bachelor's degree in Computer Science", importance: 'required', quote: "Bachelor's degree in Computer Science" }],
      },
      {
        profile: {
          targetRoles: ['Senior Software Engineer'], seniority: 'senior', preferredTech: [], excludedTech: [], excludedCompanies: [],
          employmentTypes: ['contractor'], salaryFloorMinor: null, salaryCurrency: 'USD', spokenLanguages: ['en'],
        },
        careerItems: [{
          id: '00000000-0000-4000-8000-000000000001', type: 'role', title: 'Senior Software Engineer', organization: 'FullStack Labs',
          startedOn: '2021-12', endedOn: '2026-01', isCurrent: false, summary: null, achievements: [], technologies: ['TypeScript'], verifiedByUser: false,
        }],
      },
      today,
    )
    const sections = explainMatch(result, [{ text: "Bachelor's degree in Computer Science", importance: 'required', quote: "Bachelor's degree in Computer Science" }])

    expect(sections.map((s) => s.headline)).toEqual([
      'Required skills: 1 of 2 shown on your record',
      'Role: “Senior Backend Engineer” is close to your target “Senior Software Engineer”',
      'Seniority: Senior role; you target senior',
      'Not compared: 1 other requirement',
    ])
    expect(sections[0]?.details).toEqual([
      '✓ TypeScript — Senior Software Engineer at FullStack Labs (unconfirmed)',
      '✗ Kubernetes — “Deep knowledge of Kubernetes”',
    ])
    expect(sections[3]?.details).toEqual(["Required: Bachelor's degree in Computer Science"])
  })
})
