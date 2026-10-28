import { describe, expect, it } from 'vitest'
import { err, ok } from '@/lib/result'
import type { ModelTrace } from '@/modules/ai'
import type { FormQuestion } from '@/modules/job-sources'
import { draftExperience, sourceText, type ExperienceItem, type ExperienceOutput, type WriteExperience } from './experience.js'
import type { ExperienceInput } from './prompts/write-experience.js'

const acme: ExperienceItem = {
  id: '6f1c2a51-0000-4000-8000-000000000001', type: 'role', organization: 'Acme Corp', title: 'Senior Software Engineer',
  startedOn: '2019-03', endedOn: null, isCurrent: true, summary: 'Payments team.',
  achievements: ['Built the payments API in Python and PostgreSQL.', 'Cut checkout latency by 30% with a Redis cache.'],
  technologies: ['Python', 'PostgreSQL', 'Redis'],
}
const globex: ExperienceItem = {
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
function writer(...outputs: ExperienceOutput[]) {
  const inputs: ExperienceInput[] = []
  const write: WriteExperience = async (input) => {
    inputs.push(input)
    const output = outputs.shift()
    if (!output) throw new Error('writer called more times than scripted')
    return ok({ value: output, traces: [trace(1_000)] })
  }
  return { write, inputs }
}

const GROUNDED: ExperienceOutput = {
  covered: true,
  sentences: [
    { text: 'At Acme Corp I built the payments API in Python and PostgreSQL.', sources: [{ item: 'i1', quote: 'Built the payments API in Python and PostgreSQL' }] },
    { text: 'I also cut checkout latency by 30% with a Redis cache.', sources: [{ item: 'i1', quote: 'Cut checkout latency by 30%' }] },
  ],
}
const INVENTED: ExperienceOutput = {
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
    const draft = await draftExperience(write, question, [acme, globex])
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
    const draft = await draftExperience(write, question, [acme, globex])
    expect(draft).toMatchObject({ ok: true, value: { kind: 'drafted' } })
    expect(inputs[1]?.problems).toEqual(['Sentence 1 uses “Django”, which the items it cites do not contain.'])
    expect(draft.ok && draft.value.traces).toHaveLength(2)
  })

  it('rejects a draft that fails the check twice, saying why, and never offers it', async () => {
    const { write } = writer(INVENTED, INVENTED)
    const draft = await draftExperience(write, question, [acme, globex])
    expect(draft).toMatchObject({ ok: true, value: { kind: 'rejected', reason: expect.stringContaining('“Django”') } })
    expect(draft.ok && 'text' in draft.value).toBe(false)
  })

  it('takes the model at its word when the items do not cover the question, without a retry', async () => {
    const { write, inputs } = writer({ covered: false, sentences: [] })
    expect(await draftExperience(write, question, [globex])).toMatchObject({ ok: true, value: { kind: 'not_covered' } })
    expect(inputs).toHaveLength(1)
  })

  it('rejects a covered answer with no sentences', async () => {
    const { write } = writer({ covered: true, sentences: [] }, { covered: true, sentences: [] })
    expect(await draftExperience(write, question, [acme])).toMatchObject({ ok: true, value: { kind: 'rejected' } })
  })

  it('rejects unusable model output, and stops the run when the provider is unavailable', async () => {
    const invalid: WriteExperience = async () => err({ code: 'validation_failed', message: 'bad', traces: [trace(500)] })
    expect(await draftExperience(invalid, question, [acme])).toMatchObject({ ok: true, value: { kind: 'rejected', traces: [{ costMicroUsd: 500 }] } })
    const limited: WriteExperience = async () => err({ code: 'rate_limited', message: 'gemini: HTTP 429', traces: [] })
    expect(await draftExperience(limited, question, [acme])).toMatchObject({ ok: false, error: { code: 'rate_limited' } })
  })
})
