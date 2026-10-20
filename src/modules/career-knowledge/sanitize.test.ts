import { describe, expect, it } from 'vitest'
import { sanitizeExtractedResume } from './sanitize.js'
import type { ExtractedItem } from './types.js'

const resume = `María López
Senior Backend Engineer — Acme Corp
Mar 2020 – Present
• Reduced p99 latency by 40%
  across the checkout service
• Led migration from Heroku to AWS
Stack: Node.js, TypeScript, PostgreSQL

Backend Developer — Globex S.A. de C.V.
2017 – ene 2020
• Built the billing API in Go

Universidad Nacional — B.Sc. Computer Science, 2016`

function item(overrides: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    type: 'role',
    organization: 'Acme Corp',
    title: 'Senior Backend Engineer',
    startedOn: { value: '2020-03', quote: 'Mar 2020' },
    endedOn: null,
    current: { quote: 'Present' },
    summary: null,
    achievements: ['Reduced p99 latency by 40% across the checkout service'],
    technologies: ['Node.js', 'TypeScript'],
    ...overrides,
  }
}

describe('sanitizeExtractedResume', () => {
  it('keeps verbatim values and stores the source text, not the model rendition', () => {
    const { drafts, rejected } = sanitizeExtractedResume(
      { items: [item({ organization: 'ACME CORP', technologies: ['node.js'] })] },
      resume,
    )
    expect(rejected).toEqual([])
    expect(drafts[0]).toMatchObject({
      organization: 'Acme Corp',
      title: 'Senior Backend Engineer',
      startedOn: '2020-03',
      endedOn: null,
      isCurrent: true,
      achievements: ['Reduced p99 latency by 40% across the checkout service'],
      technologies: ['Node.js'],
    })
    const span = drafts[0]?.evidence.achievements[0]
    expect(span && resume.slice(span.start, span.end)).toBe(
      'Reduced p99 latency by 40%\n  across the checkout service',
    )
  })

  it('drops an achievement that is not in the resume and says why', () => {
    const { drafts, rejected } = sanitizeExtractedResume(
      {
        items: [
          item({
            achievements: [
              'Led migration from Heroku to AWS',
              'Cut infrastructure costs by 30%', // invented
            ],
          }),
        ],
      },
      resume,
    )
    expect(drafts[0]?.achievements).toEqual(['Led migration from Heroku to AWS'])
    expect(drafts[0]?.evidence.achievements).toHaveLength(1)
    expect(rejected).toContainEqual({
      itemIndex: 0,
      field: 'achievements',
      value: 'Cut infrastructure costs by 30%',
      reason: 'not_in_source',
    })
  })

  it('nulls a scalar field whose text is not in the resume', () => {
    const { drafts, rejected } = sanitizeExtractedResume(
      { items: [item({ title: 'Staff Backend Engineer' })] },
      resume,
    )
    expect(drafts[0]?.title).toBeNull()
    expect(rejected).toContainEqual(
      expect.objectContaining({ field: 'title', reason: 'not_in_source' }),
    )
  })

  it('drops a technology that only appears inside another word', () => {
    const { drafts, rejected } = sanitizeExtractedResume(
      { items: [item({ technologies: ['Node.js', 'SQL', 'Rust'] })] },
      resume,
    )
    // "SQL" appears only inside "PostgreSQL"; "Rust" not at all.
    expect(drafts[0]?.technologies).toEqual(['Node.js'])
    expect(rejected.map((r) => r.value)).toEqual(['SQL', 'Rust'])
  })

  it('downgrades a date to its year when the quote does not state the month', () => {
    const { drafts, rejected } = sanitizeExtractedResume(
      {
        items: [
          item({
            organization: 'Globex S.A. de C.V.',
            title: 'Backend Developer',
            startedOn: { value: '2017-01', quote: '2017' }, // month invented
            endedOn: { value: '2020-01', quote: 'ene 2020' }, // Spanish month, stated
            current: null,
            achievements: [],
            technologies: [],
          }),
        ],
      },
      resume,
    )
    expect(drafts[0]).toMatchObject({ startedOn: '2017', endedOn: '2020-01', isCurrent: false })
    expect(rejected).toEqual([
      { itemIndex: 0, field: 'startedOn', value: '2017-01', reason: 'month_not_in_quote' },
    ])
  })

  it('drops a date whose quote is missing or states another year', () => {
    const { drafts, rejected } = sanitizeExtractedResume(
      {
        items: [
          item({
            startedOn: { value: '2019-03', quote: 'Mar 2020' },
            endedOn: { value: '2023-06', quote: 'June 2023' },
            current: null,
          }),
        ],
      },
      resume,
    )
    expect(drafts[0]).toMatchObject({ startedOn: null, endedOn: null })
    expect(rejected.map((r) => [r.field, r.reason])).toEqual([
      ['startedOn', 'date_not_in_quote'],
      ['endedOn', 'not_in_source'],
    ])
  })

  it('accepts "current" only with a present-tense marker, and then drops any end date', () => {
    const marked = sanitizeExtractedResume(
      { items: [item({ endedOn: { value: '2020-03', quote: 'Mar 2020' } })] },
      resume,
    )
    expect(marked.drafts[0]).toMatchObject({ isCurrent: true, endedOn: null })
    expect(marked.rejected).toContainEqual(
      expect.objectContaining({ field: 'endedOn', reason: 'conflicts_with_current' }),
    )

    const unmarked = sanitizeExtractedResume({ items: [item({ current: { quote: 'Mar 2020' } })] }, resume)
    expect(unmarked.drafts[0]?.isCurrent).toBe(false)
    expect(unmarked.rejected).toContainEqual(
      expect.objectContaining({ field: 'current', reason: 'not_marked_current' }),
    )
  })

  it('drops an entry when nothing identifying survives', () => {
    const { drafts, rejected } = sanitizeExtractedResume(
      {
        items: [
          item({
            organization: 'Initech',
            title: 'CTO',
            summary: null,
            achievements: ['Grew revenue 10x'],
            technologies: [],
          }),
          item(),
        ],
      },
      resume,
    )
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.organization).toBe('Acme Corp')
    expect(rejected).toContainEqual(expect.objectContaining({ itemIndex: 0, reason: 'empty_item' }))
  })

  it('keeps education entries with the same discipline', () => {
    const { drafts } = sanitizeExtractedResume(
      {
        items: [
          item({
            type: 'education',
            organization: 'Universidad Nacional',
            title: 'B.Sc. Computer Science',
            startedOn: null,
            endedOn: { value: '2016', quote: '2016' },
            current: null,
            achievements: [],
            technologies: [],
          }),
        ],
      },
      resume,
    )
    expect(drafts[0]).toMatchObject({ type: 'education', endedOn: '2016', isCurrent: false })
  })
})
