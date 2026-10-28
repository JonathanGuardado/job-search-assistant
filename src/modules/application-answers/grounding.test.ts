import { describe, expect, it } from 'vitest'
import { checkGrounding, describeFailures, type DraftSentence, type GroundingSource } from './grounding.js'

const sources: GroundingSource[] = [
  {
    ref: 'i1',
    text: `Senior Software Engineer at Acme Corp, March 2019 – present
Built the payments API in Python and PostgreSQL, serving 2 million requests a day.
Cut checkout latency by 30% by moving pricing to a Redis cache.
Technologies: Python, PostgreSQL, Redis, CI/CD`,
  },
  {
    ref: 'i2',
    text: `Software Engineer at Globex, 2015 – February 2019
Maintained the Java billing service and led a team of 4 engineers.
Technologies: Java, Kubernetes`,
  },
]

const sentence = (text: string, ...cites: [string, string][]): DraftSentence => ({ text, cites: cites.map(([ref, quote]) => ({ ref, quote })) })
const check = (question: string, ...sentences: DraftSentence[]) => checkGrounding({ question, sources, sentences })
const terms = (failures: ReturnType<typeof checkGrounding>) => failures.flatMap((f) => (f.problem === 'unsupported_term' ? [f.term] : []))

describe('the grounding check on a written draft', () => {
  it('passes sentences that cite an item, quote it verbatim, and add nothing it does not say', () => {
    expect(check('Describe your Python development experience',
      sentence('At Acme Corp I built the payments API in Python and PostgreSQL, serving 2 million requests a day.',
        ['i1', 'Built the payments API in Python and PostgreSQL']),
      sentence('I also cut checkout latency by 30% by moving pricing to a Redis cache.', ['i1', 'Cut checkout latency by 30%'])),
    ).toEqual([])
  })

  it('accepts a quote with different spacing or capitalization, and dates as the record renders them', () => {
    expect(check('Describe your experience',
      sentence('I have been a Senior Software Engineer at Acme Corp since March 2019.', ['i1', 'senior software engineer   at acme corp'])),
    ).toEqual([])
  })

  it('rejects a sentence with no citation, or one citing an item it was not given', () => {
    expect(check('Describe your experience', sentence('I enjoy hard problems.'))).toEqual([{ sentence: 0, problem: 'no_citation' }])
    expect(check('Describe your experience', sentence('I built the payments API.', ['i9', 'Built the payments API'])))
      .toEqual([{ sentence: 0, problem: 'unknown_source', ref: 'i9' }])
  })

  it('rejects a quote not found in the item it cites, even when another item has it', () => {
    expect(check('Describe your experience', sentence('I led a team of 4 engineers.', ['i1', 'led a team of 4 engineers'])))
      .toContainEqual({ sentence: 0, problem: 'quote_not_found', ref: 'i1', quote: 'led a team of 4 engineers' })
  })

  it('rejects a trivially short quote', () => {
    expect(check('Describe your experience', sentence('I built the payments API.', ['i1', 'the'])))
      .toContainEqual({ sentence: 0, problem: 'quote_not_found', ref: 'i1', quote: 'the' })
  })

  it('rejects a technology the question names but the cited items do not', () => {
    const failures = check('Describe your experience with OpenStack, Kubernetes or other major open source infrastructure',
      sentence('At Acme Corp I deployed the payments API on Kubernetes.', ['i1', 'Built the payments API']))
    expect(terms(failures)).toEqual(['Kubernetes'])
  })

  it('checks terms against the items a sentence cites, not every item', () => {
    // Globex mentions Kubernetes; the sentence cites only Acme.
    expect(terms(check('Describe your experience', sentence('I ran Kubernetes at Acme Corp.', ['i1', 'Senior Software Engineer at Acme Corp']))))
      .toEqual(['Kubernetes'])
    expect(check('Describe your experience', sentence('I ran Kubernetes at Globex.', ['i2', 'Technologies: Java, Kubernetes']))).toEqual([])
  })

  it('rejects an ordinary word the question asks about when the cited items never use it', () => {
    const failures = check('What is your experience building or extending search indexing and retrieval systems at scale?',
      sentence('I built search indexing for the payments API at Acme Corp.', ['i1', 'Built the payments API']))
    expect(terms(failures)).toEqual(['search', 'indexing'])
  })

  it('does not count the question\'s generic words, such as describe, experience or professional', () => {
    expect(check('Describe your professional experience in customer-facing technical roles, highlighting your contribution',
      sentence('My professional experience includes building the payments API at Acme Corp.', ['i1', 'Built the payments API']))).toEqual([])
  })

  it('rejects a number, a name or a technology-shaped token the cited items do not contain', () => {
    expect(terms(check('Describe your experience', sentence('I cut checkout latency by 40% at Acme Corp.', ['i1', 'Cut checkout latency by 30%']))))
      .toEqual(['40%'])
    expect(terms(check('Describe your experience', sentence('Before Acme Corp I worked at Google.', ['i1', 'Senior Software Engineer at Acme Corp']))))
      .toEqual(['Google'])
    expect(terms(check('Describe your experience', sentence('I wrote services in node.js and C++ at Acme Corp.', ['i1', 'Built the payments API']))))
      .toEqual(['node.js', 'C++'])
    expect(check('Describe your experience', sentence('I set up CI/CD at Acme Corp.', ['i1', 'Technologies: Python, PostgreSQL, Redis, CI/CD']))).toEqual([])
  })

  it('lets a common word start a sentence, but not a name or technology', () => {
    expect(check('Describe your experience', sentence('During my time at Acme Corp, I built the payments API.', ['i1', 'Built the payments API']))).toEqual([])
    expect(terms(check('Describe your experience', sentence('Terraform managed the payments API at Acme Corp.', ['i1', 'Built the payments API']))))
      .toEqual(['Terraform'])
  })

  it('rejects a placeholder copied from an unfinished career item', () => {
    const unfinished: GroundingSource[] = [{ ref: 'i1', text: 'Led a team of [N] engineers and cut costs by [X%] per [period].' }]
    const sentences = [sentence('I led a team of [N] engineers and cut costs by [X%].', ['i1', 'Led a team of [N] engineers'])]
    const failures = checkGrounding({ question: 'Describe your leadership experience', sources: unfinished, sentences })
    expect(failures).toEqual([{ sentence: 0, problem: 'placeholder', text: '[N]' }, { sentence: 0, problem: 'placeholder', text: '[X%]' }])
    expect(describeFailures(failures)[0]).toBe('Sentence 1 contains the placeholder “[N]”; leave that detail out.')
  })

  it('names every problem in words a retry or the owner can act on', () => {
    const sentences = [
      sentence('I deployed Kubernetes at Acme Corp.', ['i1', 'Built the payments API']),
      sentence('I enjoy hard problems.'),
    ]
    const described = describeFailures(checkGrounding({ question: 'Describe your Kubernetes experience', sources, sentences }))
    expect(described).toEqual([
      'Sentence 1 uses “Kubernetes”, which the items it cites do not contain.',
      'Sentence 2 cites no career item.',
    ])
  })
})
