import { describe, expect, it } from 'vitest'
import { createLocator } from './verbatim.js'

const source = [
  'ACME CORP — Senior Backend Engineer',
  'Jan 2020 – Present',
  '• Reduced p99 latency by 40%\nacross the checkout service',
  'Stack: Node.js, TypeScript, Go, C++',
  'Worked at Google on ﬁnance tooling',
].join('\n')

describe('createLocator', () => {
  const locate = createLocator(source)

  it('finds an exact quote and returns offsets into the original text', () => {
    const span = locate('Senior Backend Engineer')
    expect(span).not.toBeNull()
    expect(source.slice(span!.start, span!.end)).toBe('Senior Backend Engineer')
    expect(span!.text).toBe('Senior Backend Engineer')
  })

  it('tolerates line wrapping, spacing and case differences', () => {
    const span = locate('reduced P99 latency by 40%   across the checkout service')
    expect(span).not.toBeNull()
    expect(source.slice(span!.start, span!.end)).toBe(
      'Reduced p99 latency by 40%\nacross the checkout service',
    )
  })

  it('tolerates typographic dashes, quotes and PDF ligatures', () => {
    expect(locate('ACME CORP - Senior')).not.toBeNull()
    expect(locate('Jan 2020 - Present')).not.toBeNull()
    const span = locate('finance tooling')
    expect(span).not.toBeNull()
    expect(source.slice(span!.start, span!.end)).toBe('ﬁnance tooling')
  })

  it('rejects text that is not in the source', () => {
    expect(locate('Reduced p99 latency by 45%')).toBeNull()
    expect(locate('Staff Engineer')).toBeNull()
  })

  it('rejects empty and whitespace-only quotes', () => {
    expect(locate('')).toBeNull()
    expect(locate('   \n ')).toBeNull()
  })

  it('can require whole-word matches, so "Go" is not found inside "Google"', () => {
    const wholeWord = { wholeWord: true }
    expect(locate('go', wholeWord)).not.toBeNull() // the "Go," entry
    expect(locate('Goo', wholeWord)).toBeNull()
    expect(locate('C++', wholeWord)).not.toBeNull()
    expect(locate('Node.js', wholeWord)).not.toBeNull()
  })
})
