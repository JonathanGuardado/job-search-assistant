import { describe, expect } from 'vitest'
import { withTenant } from '@/lib/db/tenancy'
import { dbTest as test } from '@/lib/db/testing'
import { ok, unwrap } from '@/lib/result'
import type { ModelTrace } from '@/modules/ai'
import { questionKey } from './readiness.js'
import {
  acceptSuggestion, canApplyJobs, deleteSavedAnswer, getApplicantDetails, listSavedAnswers, openQuestions, readinessForJobs,
  refreshQuestionMatches, saveAnswer, saveApplicantDetails, type MatchQuestions,
} from './service.js'
import { aBoard, aCandidate, aJob, makeEligible, storeForm } from './test-fixtures.js'

const details = { firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.com', phone: null, linkedinUrl: 'https://www.linkedin.com/in/ana', githubUrl: null, websiteUrl: null }
const MATH = 'How did you perform in mathematics at high school?'
const trace: ModelTrace = {
  task: 'application-answers.match-questions', taskVersion: 1, provider: 'fake', model: 'fake-model', attempt: 1, stopReason: 'stop',
  inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 500, latencyMs: 1, rawOutput: '{}', validationError: null,
}

/** A stand-in that pairs each unanswered question whose label passes `pick` with the first answered question. */
function stubMatcher(pick: (label: string) => boolean) {
  const calls: Parameters<MatchQuestions>[0][] = []
  const match: MatchQuestions = async (input) => {
    calls.push(input)
    const answered = input.answered[0]?.id ?? 'none'
    return ok({ value: { matches: input.unanswered.filter((q) => pick(q.label)).map((q) => ({ unanswered: q.id, answered })) }, traces: [trace] })
  }
  return { match, calls }
}

describe('the candidate\'s details and saved answers', () => {
  test('saves, replaces and deletes, and keeps each candidate\'s own', async ({ db }) => {
    const [owner, other] = [await aCandidate(db), await aCandidate(db)]
    await withTenant(db, owner, async (scope) => {
      unwrap(await saveApplicantDetails(scope, details))
      unwrap(await saveAnswer(scope, { label: `${MATH}  `, answer: { kind: 'choice', labels: ['Cannot recall'] } }))
      unwrap(await saveAnswer(scope, { label: MATH.toUpperCase(), answer: { kind: 'choice', labels: ['Top 20% at school'] } }))
      expect(await getApplicantDetails(scope)).toEqual(details)
      expect(await listSavedAnswers(scope)).toEqual([expect.objectContaining({ questionKey: questionKey(MATH), label: `${MATH}  `, answer: { kind: 'choice', labels: ['Top 20% at school'] } })])
    })
    await withTenant(db, other, async (scope) => {
      expect(await getApplicantDetails(scope)).toBeNull()
      expect(await listSavedAnswers(scope)).toEqual([])
      expect(await deleteSavedAnswer(scope, questionKey(MATH))).toMatchObject({ ok: false, error: { code: 'not_found' } })
    })
    await withTenant(db, owner, async (scope) => {
      unwrap(await deleteSavedAnswer(scope, questionKey(MATH)))
      expect(await listSavedAnswers(scope)).toEqual([])
    })
  })
})

describe('readiness of the jobs a candidate can apply to', () => {
  test('assesses stored forms, and says which jobs have no form yet or none to fetch', async ({ db }) => {
    const userId = await aCandidate(db)
    const board = await aBoard(db)
    const [withForm, withoutForm] = [await aJob(db, board, 'Kernel Engineer'), await aJob(db, board, 'Storage Engineer')]
    await storeForm(db, withForm, 'canonical')
    for (const job of [withForm, withoutForm]) await makeEligible(db, userId, job)
    await withTenant(db, userId, async (scope) => unwrap(await saveApplicantDetails(scope, details)))

    expect((await canApplyJobs(db, userId)).map((j) => j.id).sort()).toEqual([withForm.id, withoutForm.id].sort())
    const readiness = await readinessForJobs(db, userId, [withForm, withoutForm])
    expect(readiness.get(withoutForm.id)).toEqual({ kind: 'not_fetched' })
    const assessed = readiness.get(withForm.id)
    if (assessed?.kind !== 'assessed') throw new Error('expected an assessed form')
    expect(assessed.readiness.status).toBe('blocked')
    expect(assessed.readiness.answers.find((a) => a.question.label === 'First Name')).toMatchObject({ source: 'details', value: { kind: 'text', text: 'Ana' } })
    expect(assessed.readiness.blockers.map((b) => b.question.label)).toContain(MATH)
    expect(assessed.readiness.blockers.map((b) => b.question.label)).toContain('Resume/CV')
    // Lever publishes no structured form: its jobs are unsupported, not waiting for a fetch.
    const lever = { id: '00000000-0000-4000-8000-00000000abcd', sourceId: (await aBoard(db, 'lever')).id, externalId: 'abc' }
    expect((await readinessForJobs(db, userId, [lever])).get(lever.id)).toEqual({ kind: 'unsupported' })
  })

  test('lists open questions, the most widely blocking first, answered by details or by a saved answer', async ({ db }) => {
    const userId = await aCandidate(db)
    const board = await aBoard(db)
    const jobs = [await aJob(db, board, 'Kernel Engineer'), await aJob(db, board, 'Cloud Engineer')]
    await storeForm(db, jobs[0]!, 'canonical')
    await storeForm(db, jobs[1]!, 'gitlab')
    const open = openQuestions(await readinessForJobs(db, userId, jobs))
    const first = open[0]
    expect(first?.jobIds).toHaveLength(2)
    expect(open.find((q) => q.label === 'First Name')).toMatchObject({ answeredBy: 'details', jobIds: expect.arrayContaining(jobs.map((j) => j.id)) })
    expect(open.find((q) => q.label === MATH)).toMatchObject({ answeredBy: 'saved_answer', jobIds: [jobs[0]!.id] })
    for (let i = 1; i < open.length; i++) expect(open[i - 1]!.jobIds.length).toBeGreaterThanOrEqual(open[i]!.jobIds.length)
  })
})

describe('"same question, different wording" suggestions', () => {
  const mathAnswer = { label: 'How well did you do in high-school math?', answer: { kind: 'choice' as const, labels: ['Top 20% at school'] } }

  test('offers the candidate\'s own answer to a differently worded question, once per set of inputs', async ({ db }) => {
    const userId = await aCandidate(db)
    const job = await aJob(db, await aBoard(db))
    await storeForm(db, job, 'canonical')
    await makeEligible(db, userId, job)
    await withTenant(db, userId, async (scope) => unwrap(await saveAnswer(scope, mathAnswer)))

    const { match, calls } = stubMatcher((label) => label === MATH)
    expect(unwrap(await refreshQuestionMatches(db, userId, match))).toEqual({ kind: 'matched', suggestions: 1 })
    expect(calls[0]?.answered).toEqual([{ id: 'a1', label: mathAnswer.label, options: ['Top 20% at school'] }])
    expect(unwrap(await refreshQuestionMatches(db, userId, match))).toEqual({ kind: 'fresh' })
    expect(calls).toHaveLength(1)

    const readiness = (await readinessForJobs(db, userId, [job])).get(job.id)
    if (readiness?.kind !== 'assessed') throw new Error('expected an assessed form')
    expect(readiness.suggestions.get(questionKey(MATH))).toEqual({
      savedQuestionKey: questionKey(mathAnswer.label), savedLabel: mathAnswer.label,
      value: { kind: 'choice', options: [{ label: 'Top 20% at school', value: expect.any(String) }] },
    })
    // Not used until accepted.
    expect(readiness.readiness.blockers.map((b) => b.question.label)).toContain(MATH)
  })

  test('drops a pair whose saved answer this question cannot take, and an id the model invented', async ({ db }) => {
    const userId = await aCandidate(db)
    const job = await aJob(db, await aBoard(db))
    await storeForm(db, job, 'canonical')
    await makeEligible(db, userId, job)
    await withTenant(db, userId, async (scope) => unwrap(await saveAnswer(scope, { label: 'Favourite colour', answer: { kind: 'choice', labels: ['Blue'] } })))
    const invented: MatchQuestions = async () => ok({ value: { matches: [{ unanswered: 'u999', answered: 'a1' }] }, traces: [trace] })
    expect(unwrap(await refreshQuestionMatches(db, userId, stubMatcher((label) => label === MATH).match))).toEqual({ kind: 'matched', suggestions: 0 })
    await withTenant(db, userId, async (scope) => unwrap(await saveAnswer(scope, { label: 'Another', answer: { kind: 'text', text: 'x' } })))
    expect(unwrap(await refreshQuestionMatches(db, userId, invented))).toEqual({ kind: 'matched', suggestions: 0 })
  })

  test('accepting a suggestion saves the same answer under the new wording, and the question unblocks', async ({ db }) => {
    const userId = await aCandidate(db)
    const job = await aJob(db, await aBoard(db))
    await storeForm(db, job, 'canonical')
    await makeEligible(db, userId, job)
    await withTenant(db, userId, async (scope) => {
      unwrap(await saveAnswer(scope, mathAnswer))
      unwrap(await acceptSuggestion(scope, { label: MATH, savedQuestionKey: questionKey(mathAnswer.label) }))
      expect(await acceptSuggestion(scope, { label: MATH, savedQuestionKey: 'missing' })).toMatchObject({ ok: false, error: { code: 'not_found' } })
    })
    const readiness = (await readinessForJobs(db, userId, [job])).get(job.id)
    if (readiness?.kind !== 'assessed') throw new Error('expected an assessed form')
    expect(readiness.readiness.answers.find((a) => a.question.label === MATH)).toMatchObject({ source: 'saved', blocker: null })
  })

  test('with nothing answered yet, there is nothing to match and no model call', async ({ db }) => {
    const userId = await aCandidate(db)
    const job = await aJob(db, await aBoard(db))
    await storeForm(db, job, 'canonical')
    await makeEligible(db, userId, job)
    const { match, calls } = stubMatcher(() => true)
    expect(unwrap(await refreshQuestionMatches(db, userId, match))).toEqual({ kind: 'nothing_to_match' })
    expect(calls).toHaveLength(0)
  })
})
