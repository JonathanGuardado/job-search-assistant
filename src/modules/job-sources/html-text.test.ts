import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { htmlToPlainText } from './html-text.js'
import { greenhouseFixture, leverFixture } from './test-fixtures.js'

describe('source HTML text', () => {
  it('decodes escaped Greenhouse HTML before rendering it', () => {
    const first = greenhouseFixture.jobs[0]
    if (!first) throw new Error('missing fixture')
    const text = htmlToPlainText(htmlToPlainText(first.content))
    expect(text).toContain('GitLab is the intelligent orchestration platform for DevSecOps.')
    expect(text).not.toMatch(/<|&lt;/)
  })
  it('renders each bare Lever list item on its own line when wrapped in a list', () => {
    const posting = z.object({ lists: z.array(z.object({ content: z.string() })) }).parse(leverFixture[0])
    const text = htmlToPlainText(`<ul>${posting.lists[0]?.content ?? ''}</ul>`)
    const lines = text.split('\n')
    expect(lines.some((line) => line.includes('3+ years of customer relationship'))).toBe(true)
    expect(lines.some((line) => line.includes('Solutions and results-oriented mindset'))).toBe(true)
    expect(lines.find((line) => line.includes('3+ years'))).not.toContain('Solutions and results-oriented')
  })
  it('keeps link text without its URL and skips images', () => {
    expect(htmlToPlainText('<p><a href="https://example.com/private">Apply here</a><img src="photo.jpg" alt="image" /></p>')).toBe('Apply here')
  })
})
