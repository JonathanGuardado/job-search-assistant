import { describe, expect, it } from 'vitest'
import { listFrom } from './back'

describe('listFrom', () => {
  it('returns to the list, tab, filters and card the job was opened from', () => {
    expect(listFrom('/jobs?tab=needs_review&company=acme&page=3#job-1')).toEqual({ href: '/jobs?tab=needs_review&company=acme&page=3#job-1', label: 'Needs review' })
  })

  it('falls back to the default list for anything that is not a jobs list', () => {
    for (const value of [undefined, ['/jobs'], 'https://evil.example/jobs', '//evil.example/jobs', '/jobsevil', '/jobs/123', '/applications']) {
      expect(listFrom(value)).toEqual({ href: '/jobs', label: 'Jobs' })
    }
  })

  it('names an unknown tab plainly', () => {
    expect(listFrom('/jobs?tab=toString')).toEqual({ href: '/jobs?tab=toString', label: 'Jobs' })
  })
})
