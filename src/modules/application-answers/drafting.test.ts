import { describe, expect } from 'vitest'
import { withTenant } from '@/lib/db/tenancy'
import { dbTest as test } from '@/lib/db/testing'
import { err, ok, unwrap } from '@/lib/result'
import type { ModelTrace } from '@/modules/ai'
import { acceptDraft, draftAnswers, type ReadQuestions } from './drafting.js'
import type { QuestionForReading } from './prompts/read-questions.js'
import { NO_DETAILS, type QuestionReading } from './question-reading.js'
import { questionKey } from './readiness.js'
import { latestDrafts, listSavedAnswers, openQuestions, readinessForJobs, saveAnswer } from './service.js'
import { aBoard, aCandidate, aJob, makeEligible, storeForm, updateProfile } from './test-fixtures.js'

const SPONSORSHIP = 'Will you now or in the future require sponsorship for a visa to remain in your current location?'
const GITLAB = 'Have you previously worked at or consulted for GitLab?'
const OWN_WORDS = 'During this application process I agree to use only my own words.'

const trace: ModelTrace = {
  task: 'application-answers.read-questions', taskVersion: 1, provider: 'fake', model: 'fake-model', attempt: 1, stopReason: 'stop',
  inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 900, latencyMs: 1, rawOutput: '{}', validationError: null,
}

/** A stand-in that reads GitLab's two profile facts and calls everything else owner_only. Country of residence never blocks: 2.1 fills it. */
function stubReader() {
  const seen: QuestionForReading[] = []
  const kindOf = (label: string): Pick<QuestionReading, 'kind' | 'company'> =>
    label.startsWith(SPONSORSHIP.slice(0, 40)) ? { kind: 'needs_sponsorship', company: null }
      : label.startsWith(GITLAB) ? { kind: 'worked_at', company: 'GitLab' }
        : { kind: 'owner_only', company: null }
  const read: ReadQuestions = async ({ questions }) => {
    seen.push(...questions)
    return ok({ value: { readings: questions.map((q) => ({ id: q.id, ...NO_DETAILS, ...kindOf(q.label) })) }, traces: [trace] })
  }
  return { read, seen }
}

async function aCandidateWithForms(db: Parameters<typeof aCandidate>[0], citizenships: string[] = ['SV']) {
  const userId = await aCandidate(db, { citizenships })
  const board = await aBoard(db)
  const jobs = [await aJob(db, board, 'Software Engineer'), await aJob(db, board, 'Senior Software Engineer')]
  await storeForm(db, jobs[0]!, 'gitlab')
  await storeForm(db, jobs[1]!, 'canonical')
  for (const job of jobs) await makeEligible(db, userId, job)
  return { userId, jobs }
}

describe('drafting answers from the profile', () => {
  test('drafts profile facts from the record, and never sends a consent, demographic or school question to be read', async ({ db }) => {
    const { userId, jobs } = await aCandidateWithForms(db)
    const { read, seen } = stubReader()

    const outcome = unwrap(await draftAnswers(db, userId, read))
    expect(outcome).toMatchObject({ drafted: 1, noBasis: 1 })
    expect(outcome.neverDrafted).toBeGreaterThanOrEqual(4)
    const labels = seen.map((q) => q.label)
    for (const pattern of [/own words/, /gender/i, /race or ethnicity/, /high school/, /Privacy Notice/]) expect(labels.some((l) => pattern.test(l))).toBe(false)

    const drafts = await withTenant(db, userId, latestDrafts)
    expect(drafts.get(questionKey(SPONSORSHIP))).toMatchObject({
      method: 'profile', status: 'drafted', answer: { kind: 'choice', labels: ['No'] }, basis: { facts: expect.arrayContaining(['Citizenship: El Salvador']) },
    })
    // No confirmed roles: the record cannot say, so it does not.
    expect(drafts.get(questionKey(GITLAB))).toMatchObject({ status: 'no_basis', answer: null, reason: expect.stringMatching(/career record/) })

    const open = openQuestions(await readinessForJobs(db, userId, jobs))
    expect(open.find((q) => q.questionKey === questionKey(SPONSORSHIP))?.draft?.answer).toEqual({ kind: 'choice', labels: ['No'] })
    expect(open.find((q) => q.label.startsWith(OWN_WORDS))).toMatchObject({ neverDrafted: 'consent', draft: null })
  })

  test('reads each wording once for every candidate, and drafts again only when the record changes', async ({ db }) => {
    const { userId } = await aCandidateWithForms(db)
    const { read, seen } = stubReader()
    unwrap(await draftAnswers(db, userId, read))
    const readCount = seen.length

    expect(unwrap(await draftAnswers(db, userId, read))).toMatchObject({ drafted: 0, noBasis: 0, unchanged: 2 })
    const other = await aCandidateWithForms(db)
    unwrap(await draftAnswers(db, other.userId, read))
    expect(seen).toHaveLength(readCount)

    // Without a citizenship, "no sponsorship needed" is no longer something the record can say.
    await updateProfile(db, userId, { citizenships: [] })
    expect(unwrap(await draftAnswers(db, userId, read))).toMatchObject({ drafted: 0, noBasis: 1, unchanged: 1 })
    expect((await withTenant(db, userId, latestDrafts)).get(questionKey(SPONSORSHIP))).toMatchObject({ status: 'no_basis', reason: expect.stringMatching(/citizenship/) })
  })

  test('a rate-limited reading stops the run and writes nothing', async ({ db }) => {
    const { userId } = await aCandidateWithForms(db)
    const limited: ReadQuestions = async () => err({ code: 'rate_limited', message: 'gemini: HTTP 429', traces: [] })
    expect(await draftAnswers(db, userId, limited)).toMatchObject({ ok: false, error: { code: 'rate_limited' } })
    expect((await withTenant(db, userId, latestDrafts)).size).toBe(0)
  })
})

describe('accepting a draft', () => {
  test('saves it as a drafted answer, edited or not, and the question no longer blocks', async ({ db }) => {
    const { userId, jobs } = await aCandidateWithForms(db)
    unwrap(await draftAnswers(db, userId, stubReader().read))
    await withTenant(db, userId, async (scope) => {
      const drafts = await latestDrafts(scope)
      const sponsorship = drafts.get(questionKey(SPONSORSHIP))?.id ?? ''
      unwrap(await acceptDraft(scope, { draftId: sponsorship }))
      expect((await listSavedAnswers(scope))[0]).toMatchObject({ questionKey: questionKey(SPONSORSHIP), origin: 'draft', answer: { kind: 'choice', labels: ['No'] } })
      unwrap(await acceptDraft(scope, { draftId: sponsorship, answer: { kind: 'choice', labels: ['Yes, EU Blue Card'] } }))
      expect((await listSavedAnswers(scope))[0]).toMatchObject({ origin: 'draft', answer: { kind: 'choice', labels: ['Yes, EU Blue Card'] } })
      // A question with no draft has nothing to accept, even with an answer supplied.
      const gitlab = drafts.get(questionKey(GITLAB))?.id ?? ''
      expect(await acceptDraft(scope, { draftId: gitlab, answer: { kind: 'choice', labels: ['No'] } })).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
      // Rewritten by the candidate, it is theirs.
      unwrap(await saveAnswer(scope, { label: SPONSORSHIP, answer: { kind: 'choice', labels: ['No'] } }))
      expect((await listSavedAnswers(scope))[0]).toMatchObject({ origin: 'owner' })
    })
    const readiness = (await readinessForJobs(db, userId, [jobs[0]!])).get(jobs[0]!.id)
    if (readiness?.kind !== 'assessed') throw new Error('expected an assessed form')
    expect(readiness.readiness.answers.find((a) => a.questionKey === questionKey(SPONSORSHIP))).toMatchObject({ source: 'saved', blocker: null })
  })

  test('another candidate\'s draft cannot be accepted', async ({ db }) => {
    const { userId } = await aCandidateWithForms(db)
    unwrap(await draftAnswers(db, userId, stubReader().read))
    const draftId = (await withTenant(db, userId, latestDrafts)).get(questionKey(SPONSORSHIP))?.id ?? ''
    const stranger = await aCandidate(db)
    expect(await withTenant(db, stranger, (scope) => acceptDraft(scope, { draftId }))).toMatchObject({ ok: false, error: { code: 'not_found' } })
  })
})
