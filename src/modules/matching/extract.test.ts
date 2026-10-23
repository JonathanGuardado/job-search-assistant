import { describe, expect, it } from 'vitest'
import { postingText, requirementsFromOutput, validateRequirements } from './extract.js'
import { NO_REQUIREMENTS } from './types.js'

const text = postingText({
  title: 'Senior Backend Engineer',
  description: 'You have 5+ years of   experience with Node.js.\nFluent Portuguese.\nNice to have: Kubernetes.',
})

describe('requirementsFromOutput', () => {
  it('keeps overall experience only when both years and a quote were given', () => {
    const base = { skills: [], languages: [], other: [] }
    expect(requirementsFromOutput({ ...base, experience: { minYears: 5, quote: '5+ years' } }).experience).toEqual({ minYears: 5, quote: '5+ years' })
    expect(requirementsFromOutput({ ...base, experience: { minYears: null, quote: null } }).experience).toBeNull()
    expect(requirementsFromOutput({ ...base, experience: { minYears: 5, quote: ' ' } }).experience).toBeNull()
  })
})

describe('validateRequirements', () => {
  it('keeps entries whose quote is in the posting, ignoring case and spacing', () => {
    const { requirements, stripped, quoted } = validateRequirements({
      ...NO_REQUIREMENTS,
      skills: [{ name: 'Node.js', importance: 'required', minYears: 5, quote: '5+ years of experience with node.js' }],
      experience: { minYears: 5, quote: 'You have 5+ years of experience' },
      languages: [{ language: 'pt', importance: 'required', quote: 'Fluent Portuguese' }],
    }, text)
    expect(stripped).toBe(0)
    expect(quoted).toBe(3)
    expect(requirements.skills).toHaveLength(1)
    expect(requirements.experience).not.toBeNull()
  })

  it('drops entries whose quote is not in the posting and counts them', () => {
    const { requirements, stripped } = validateRequirements({
      ...NO_REQUIREMENTS,
      skills: [
        { name: 'Kubernetes', importance: 'preferred', minYears: null, quote: 'Nice to have: Kubernetes' },
        { name: 'Go', importance: 'required', minYears: null, quote: 'Strong Go skills' },
      ],
      experience: { minYears: 8, quote: '8+ years' },
      other: [{ text: 'CS degree', importance: 'required', quote: 'BS in Computer Science' }],
    }, text)
    expect(requirements.skills.map((s) => s.name)).toEqual(['Kubernetes'])
    expect(requirements.experience).toBeNull()
    expect(requirements.other).toEqual([])
    expect(stripped).toBe(3)
  })
})
