import { describe, expect, it } from 'vitest'
import { parseAnswer, parseJobId } from './answer-input'

describe('parseAnswer', () => {
  it('keeps every selected option label', () => {
    const form = new FormData()
    form.set('kind', 'choice')
    form.append('option', ' Remote ')
    form.append('option', 'Hybrid')
    expect(parseAnswer(form)).toEqual({ ok: true, value: { kind: 'choice', labels: ['Remote', 'Hybrid'] } })
  })

  it('requires at least one option for a choice', () => {
    const form = new FormData()
    form.set('kind', 'choice')
    expect(parseAnswer(form)).toEqual({
      ok: false, error: { code: 'invalid_input', message: 'Choose or write an answer.' },
    })
  })

  it.each([null, '', ' \n '])('rejects blank text: %s', (text) => {
    const form = new FormData()
    form.set('kind', 'text')
    if (text !== null) form.set('text', text)
    expect(parseAnswer(form)).toEqual({
      ok: false, error: { code: 'invalid_input', message: 'Choose or write an answer.' },
    })
  })

  it('trims a written answer', () => {
    const form = new FormData()
    form.set('kind', 'text')
    form.set('text', ' My own answer. ')
    expect(parseAnswer(form)).toEqual({ ok: true, value: { kind: 'text', text: 'My own answer.' } })
  })

  it('rejects an unknown answer kind', () => {
    const form = new FormData()
    form.set('kind', 'file')
    expect(parseAnswer(form).ok).toBe(false)
  })

  it('rejects a file in place of answer text', () => {
    const form = new FormData()
    form.set('kind', 'text')
    form.set('text', new Blob(['answer']), 'answer.txt')
    expect(parseAnswer(form).ok).toBe(false)
  })
})

describe('parseJobId', () => {
  it.each([null, ''])('treats an absent or empty job id as a general answer: %s', (jobId) => {
    const form = new FormData()
    if (jobId !== null) form.set('jobId', jobId)
    expect(parseJobId(form)).toEqual({ ok: true, value: undefined })
  })

  it('keeps a valid job UUID', () => {
    const form = new FormData()
    const jobId = '00000000-0000-4000-8000-000000000002'
    form.set('jobId', jobId)
    expect(parseJobId(form)).toEqual({ ok: true, value: jobId })
  })

  it.each(['not-a-uuid', ' '])('rejects an invalid job id: %s', (jobId) => {
    const form = new FormData()
    form.set('jobId', jobId)
    expect(parseJobId(form)).toEqual({
      ok: false, error: { code: 'invalid_input', message: 'Check your answer.' },
    })
  })
})
