import { describe, expect, it } from 'vitest'
import { err, ok } from '@/lib/result'
import type { ModelTrace } from '@/modules/ai'
import type { FormQuestion } from '@/modules/job-sources'
import type { WrittenInput } from './prompts/write-experience.js'
import { draftWritten, sourceText, type WriteAnswer, type WrittenItem, type WrittenOutput } from './written.js'

const acme: WrittenItem = {
  id: '6f1c2a51-0000-4000-8000-000000000001', type: 'role', organization: 'Acme Corp', title: 'Senior Software Engineer',
  startedOn: '2019-03', endedOn: null, isCurrent: true, summary: 'Payments team.',
  achievements: ['Built the payments API in Python and PostgreSQL.', 'Cut checkout latency by 30% with a Redis cache.'],
  technologies: ['Python', 'PostgreSQL', 'Redis'],
}
const globex: WrittenItem = {
  id: '6f1c2a51-0000-4000-8000-000000000002', type: 'role', organization: 'Globex', title: 'Software Engineer',
  startedOn: '2015', endedOn: '2019-02', isCurrent: false, summary: null, achievements: ['Maintained the Java billing service.'], technologies: ['Java'],
}
const question: FormQuestion = {
  label: 'Describe your Python development experience', description: null, required: true, section: 'main',
  fields: [{ name: 'q', type: 'textarea', options: [] }],
}

const trace = (cost: number): ModelTrace => ({
  task: 'application-answers.write-experience', taskVersion: 1, provider: 'fake', model: 'fake-model', attempt: 1, stopReason: 'stop',
  inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: cost, latencyMs: 1, rawOutput: '{}', validationError: null,
})

/** Plays back outputs and records every input it was given. */
function writer(...outputs: WrittenOutput[]) {
  const inputs: WrittenInput[] = []
  const write: WriteAnswer = async (input) => {
    inputs.push(input)
    const output = outputs.shift()
    if (!output) throw new Error('writer called more times than scripted')
    return ok({ value: output, traces: [trace(1_000)] })
  }
  return { write, inputs }
}

const GROUNDED: WrittenOutput = {
  covered: true,
  sentences: [
    { text: 'At Acme Corp I built the payments API in Python and PostgreSQL.', sources: [{ item: 'i1', quote: 'Built the payments API in Python and PostgreSQL' }] },
    { text: 'I also cut checkout latency by 30% with a Redis cache.', sources: [{ item: 'i1', quote: 'Cut checkout latency by 30%' }] },
  ],
}
const INVENTED: WrittenOutput = {
  covered: true,
  sentences: [{ text: 'At Acme Corp I built the payments API in Python and Django.', sources: [{ item: 'i1', quote: 'Built the payments API in Python' }] }],
}

describe('the text a career item is written from and checked against', () => {
  it('states the role, dates in words, summary, achievements and technologies', () => {
    expect(sourceText(acme)).toBe([
      '(role) Senior Software Engineer at Acme Corp, March 2019 – present',
      'Payments team.',
      'Built the payments API in Python and PostgreSQL.',
      'Cut checkout latency by 30% with a Redis cache.',
      'Technologies: Python, PostgreSQL, Redis',
    ].join('\n'))
    expect(sourceText(globex).split('\n')[0]).toBe('(role) Software Engineer at Globex, 2015 – February 2019')
  })
})

describe('drafting a written experience answer', () => {
  it('drafts from the confirmed items, keeping the quotes and the items it rests on', async () => {
    const { write, inputs } = writer(GROUNDED)
    const draft = await draftWritten(write, question, [acme, globex])
    expect(draft).toEqual(ok(expect.objectContaining({
      kind: 'drafted',
      text: 'At Acme Corp I built the payments API in Python and PostgreSQL. I also cut checkout latency by 30% with a Redis cache.',
      itemIds: [acme.id],
      quotes: ['“Built the payments API in Python and PostgreSQL” (Senior Software Engineer at Acme Corp)', '“Cut checkout latency by 30%” (Senior Software Engineer at Acme Corp)'],
    })))
    expect(inputs[0]?.items.map((i) => i.ref)).toEqual(['i1', 'i2'])
    expect(inputs[0]?.problems).toEqual([])
  })

  it('retries once, naming what failed the check, and drafts when the retry passes', async () => {
    const { write, inputs } = writer(INVENTED, GROUNDED)
    const draft = await draftWritten(write, question, [acme, globex])
    expect(draft).toMatchObject({ ok: true, value: { kind: 'drafted' } })
    expect(inputs[1]?.problems).toEqual(['Sentence 1 uses “Django”, which the items it cites do not contain.'])
    expect(draft.ok && draft.value.traces).toHaveLength(2)
  })

  it('rejects a draft that fails the check twice, saying why, and never offers it', async () => {
    const { write } = writer(INVENTED, INVENTED)
    const draft = await draftWritten(write, question, [acme, globex])
    expect(draft).toMatchObject({ ok: true, value: { kind: 'rejected', reason: expect.stringContaining('“Django”') } })
    expect(draft.ok && 'text' in draft.value).toBe(false)
  })

  it('takes the model at its word when the items do not cover the question, without a retry', async () => {
    const { write, inputs } = writer({ covered: false, sentences: [] })
    expect(await draftWritten(write, question, [globex])).toMatchObject({ ok: true, value: { kind: 'not_covered' } })
    expect(inputs).toHaveLength(1)
  })

  it('rejects a covered answer with no sentences', async () => {
    const { write } = writer({ covered: true, sentences: [] }, { covered: true, sentences: [] })
    expect(await draftWritten(write, question, [acme])).toMatchObject({ ok: true, value: { kind: 'rejected' } })
  })

  it('rejects unusable model output, and stops the run when the provider is unavailable', async () => {
    const invalid: WriteAnswer = async () => err({ code: 'validation_failed', message: 'bad', traces: [trace(500)] })
    expect(await draftWritten(invalid, question, [acme])).toMatchObject({ ok: true, value: { kind: 'rejected', traces: [{ costMicroUsd: 500 }] } })
    const limited: WriteAnswer = async () => err({ code: 'rate_limited', message: 'gemini: HTTP 429', traces: [] })
    expect(await draftWritten(limited, question, [acme])).toMatchObject({ ok: false, error: { code: 'rate_limited' } })
  })
})

describe('drafting a motivation answer for one job', () => {
  const POSTING = 'Senior Backend Engineer at Clara\n\nClara builds corporate cards and payments for companies across Latin America. You will design payment APIs in Python.'
  const why: FormQuestion = {
    label: 'Why do you want to join Clara, and why are you the right fit for this specific role?', description: null, required: true, section: 'main',
    fields: [{ name: 'q', type: 'textarea', options: [] }],
  }

  it('says what the posting says about the company, and what the record says about the candidate', async () => {
    const { write, inputs } = writer({
      covered: true,
      sentences: [
        { text: 'I want to join Clara because it builds corporate cards and payments for companies across Latin America.', sources: [{ item: 'posting', quote: 'Clara builds corporate cards and payments' }] },
        { text: 'At Acme Corp I built the payments API in Python and PostgreSQL, close to designing payment APIs in Python.', sources: [{ item: 'i1', quote: 'Built the payments API in Python' }, { item: 'posting', quote: 'design payment APIs in Python' }] },
      ],
    })
    const draft = await draftWritten(write, why, [acme], POSTING)
    expect(draft).toEqual(ok(expect.objectContaining({
      kind: 'drafted',
      itemIds: [acme.id],
      quotes: [
        '“Clara builds corporate cards and payments” (the job posting)',
        '“Built the payments API in Python” (Senior Software Engineer at Acme Corp)',
        '“design payment APIs in Python” (the job posting)',
      ],
    })))
    expect(inputs[0]?.posting).toEqual({ ref: 'posting', text: POSTING })
  })

  it('rejects a claim about the company the posting does not make', async () => {
    const praise: WrittenOutput = {
      covered: true,
      sentences: [{ text: 'Clara is the fastest-growing fintech in Mexico.', sources: [{ item: 'posting', quote: 'Clara builds corporate cards and payments' }] }],
    }
    const { write } = writer(praise, praise)
    expect(await draftWritten(write, why, [acme], POSTING)).toMatchObject({ ok: true, value: { kind: 'rejected', reason: expect.stringContaining('“Mexico”') } })
  })
})
