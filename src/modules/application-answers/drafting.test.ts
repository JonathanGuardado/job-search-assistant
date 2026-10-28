import { describe, expect } from 'vitest'
import { withTenant } from '@/lib/db/tenancy'
import { dbTest as test } from '@/lib/db/testing'
import { err, ok, unwrap } from '@/lib/result'
import type { ModelTrace } from '@/modules/ai'
import { acceptDraft, draftAnswers, WRITTEN_DAILY_CAP_MICRO_USD, type ReadQuestions } from './drafting.js'
import type { WriteAnswer } from './written.js'
import type { QuestionForReading } from './prompts/read-questions.js'
import { NO_DETAILS, type QuestionReading } from './question-reading.js'
import { questionKey } from './readiness.js'
import { jobDraftKey, latestDrafts, listSavedAnswers, newestJobDrafts, openQuestions, readinessForJobs, saveAnswer } from './service.js'
import { aBoard, aCandidate, aJob, makeEligible, storeForm, updateProfile, withConfirmedItems, writtenQuestion } from './test-fixtures.js'

const SPONSORSHIP = 'Will you now or in the future require sponsorship for a visa to remain in your current location?'
const GITLAB = 'Have you previously worked at or consulted for GitLab?'
const OWN_WORDS = 'During this application process I agree to use only my own words.'
const PYTHON = 'Describe your Python development experience'
const KUBERNETES = 'Describe your experience with Kubernetes'
const RUST = 'Describe your experience with Rust'
const WHY = 'Why do you want to join Umbrella, and why are you the right fit for this specific role?'

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
        : [PYTHON, KUBERNETES, RUST].includes(label) ? { kind: 'experience', company: null }
          : label === WHY ? { kind: 'motivation', company: null }
            : { kind: 'owner_only', company: null }
  const read: ReadQuestions = async ({ questions }) => {
    seen.push(...questions)
    return ok({ value: { readings: questions.map((q) => ({ id: q.id, ...NO_DETAILS, ...kindOf(q.label) })) }, traces: [trace] })
  }
  return { read, seen }
}

/** For runs over forms with no written question: drafting one would be a bug. */
const noWriter: WriteAnswer = async () => { throw new Error('no written question in these forms') }

/** Writes a grounded answer to the Python question from the Acme item, and says the record does not cover anything else. */
function stubWriter(costMicroUsd = 1_000) {
  const asked: string[] = []
  const write: WriteAnswer = async ({ question, items }) => {
    asked.push(question.label)
    const acme = items.find((item) => item.text.includes('Acme Corp'))
    const value = question.label === PYTHON && acme
      ? { covered: true, sentences: [{ text: 'At Acme Corp I built the payments API in Python and PostgreSQL.', sources: [{ item: acme.ref, quote: 'Built the payments API in Python and PostgreSQL' }] }] }
      : { covered: false, sentences: [] }
    return ok({ value, traces: [{ ...trace, task: 'application-answers.write-experience', costMicroUsd }] })
  }
  return { write, asked }
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

    const outcome = unwrap(await draftAnswers(db, userId, { read, writeExperience: noWriter, writeMotivation: noWriter }))
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
    unwrap(await draftAnswers(db, userId, { read, writeExperience: noWriter, writeMotivation: noWriter }))
    const readCount = seen.length

    expect(unwrap(await draftAnswers(db, userId, { read, writeExperience: noWriter, writeMotivation: noWriter }))).toMatchObject({ drafted: 0, noBasis: 0, unchanged: 2 })
    const other = await aCandidateWithForms(db)
    unwrap(await draftAnswers(db, other.userId, { read, writeExperience: noWriter, writeMotivation: noWriter }))
    expect(seen).toHaveLength(readCount)

    // Without a citizenship, "no sponsorship needed" is no longer something the record can say.
    await updateProfile(db, userId, { citizenships: [] })
    expect(unwrap(await draftAnswers(db, userId, { read, writeExperience: noWriter, writeMotivation: noWriter }))).toMatchObject({ drafted: 0, noBasis: 1, unchanged: 1 })
    expect((await withTenant(db, userId, latestDrafts)).get(questionKey(SPONSORSHIP))).toMatchObject({ status: 'no_basis', reason: expect.stringMatching(/citizenship/) })
  })

  test('a rate-limited reading stops the run and writes nothing', async ({ db }) => {
    const { userId } = await aCandidateWithForms(db)
    const limited: ReadQuestions = async () => err({ code: 'rate_limited', message: 'gemini: HTTP 429', traces: [] })
    expect(await draftAnswers(db, userId, { read: limited, writeExperience: noWriter, writeMotivation: noWriter })).toMatchObject({ ok: false, error: { code: 'rate_limited' } })
    expect((await withTenant(db, userId, latestDrafts)).size).toBe(0)
  })
})

describe('accepting a draft', () => {
  test('saves it as a drafted answer, edited or not, and the question no longer blocks', async ({ db }) => {
    const { userId, jobs } = await aCandidateWithForms(db)
    unwrap(await draftAnswers(db, userId, { read: stubReader().read, writeExperience: noWriter, writeMotivation: noWriter }))
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
    unwrap(await draftAnswers(db, userId, { read: stubReader().read, writeExperience: noWriter, writeMotivation: noWriter }))
    const draftId = (await withTenant(db, userId, latestDrafts)).get(questionKey(SPONSORSHIP))?.id ?? ''
    const stranger = await aCandidate(db)
    expect(await withTenant(db, stranger, (scope) => acceptDraft(scope, { draftId }))).toMatchObject({ ok: false, error: { code: 'not_found' } })
  })
})

describe('drafting written experience answers', () => {
  /** A GitLab form with two written questions, and a Canonical one (own words only) with a third. */
  async function aCandidateWithWrittenQuestions(db: Parameters<typeof aCandidate>[0], confirmed = true) {
    const userId = await aCandidate(db, { citizenships: ['SV'] })
    if (confirmed) {
      await withConfirmedItems(db, userId, [{
        organization: 'Acme Corp', title: 'Senior Software Engineer', startedOn: '2019-03', endedOn: null, isCurrent: true,
        achievements: ['Built the payments API in Python and PostgreSQL.'], technologies: ['Python', 'PostgreSQL'],
      }])
    }
    const board = await aBoard(db)
    const gitlab = await aJob(db, board, 'Software Engineer')
    const canonical = await aJob(db, board, 'Senior Software Engineer')
    await storeForm(db, gitlab, 'gitlab', [writtenQuestion(PYTHON), writtenQuestion(KUBERNETES)])
    await storeForm(db, canonical, 'canonical', [writtenQuestion(RUST)])
    for (const job of [gitlab, canonical]) await makeEligible(db, userId, job)
    return userId
  }

  test('drafts what the record covers, with the quotes it rests on, and says why the rest has no draft', async ({ db }) => {
    const userId = await aCandidateWithWrittenQuestions(db)
    const { write, asked } = stubWriter()
    unwrap(await draftAnswers(db, userId, { read: stubReader().read, writeExperience: write, writeMotivation: noWriter }))

    expect([...asked].sort()).toEqual([KUBERNETES, PYTHON].sort())
    const drafts = await withTenant(db, userId, latestDrafts)
    expect(drafts.get(questionKey(PYTHON))).toMatchObject({
      method: 'experience', status: 'drafted', answer: { kind: 'text', text: 'At Acme Corp I built the payments API in Python and PostgreSQL.' },
      basis: { facts: ['“Built the payments API in Python and PostgreSQL” (Senior Software Engineer at Acme Corp)'], itemIds: [expect.any(String)] },
    })
    expect(drafts.get(questionKey(KUBERNETES))).toMatchObject({ status: 'no_basis', answer: null, reason: expect.stringMatching(/do not cover/) })
    // Canonical asks for the candidate's own words: no model writes for it.
    expect(drafts.get(questionKey(RUST))).toMatchObject({ status: 'no_basis', reason: expect.stringMatching(/own words/) })

    // Nothing changed: nothing is written, or paid for, again.
    expect(unwrap(await draftAnswers(db, userId, { read: stubReader().read, writeExperience: write, writeMotivation: noWriter }))).toMatchObject({ drafted: 0, unchanged: expect.any(Number) })
    expect(asked).toHaveLength(2)
  })

  test('stops writing for the day at the cap; "Draft now" writes one question anyway', async ({ db }) => {
    const userId = await aCandidateWithWrittenQuestions(db)
    const { write, asked } = stubWriter(WRITTEN_DAILY_CAP_MICRO_USD)

    expect(unwrap(await draftAnswers(db, userId, { read: stubReader().read, writeExperience: write, writeMotivation: noWriter }))).toMatchObject({ capped: 1 })
    expect(asked).toHaveLength(1)
    expect(unwrap(await draftAnswers(db, userId, { read: stubReader().read, writeExperience: write, writeMotivation: noWriter }))).toMatchObject({ capped: 1 })
    expect(asked).toHaveLength(1)

    const waiting = [PYTHON, KUBERNETES].find((label) => !asked.includes(label)) ?? ''
    expect(unwrap(await draftAnswers(db, userId, { read: stubReader().read, writeExperience: write, writeMotivation: noWriter }, { only: questionKey(waiting) }))).toMatchObject({ capped: 0 })
    expect(asked).toEqual(expect.arrayContaining([PYTHON, KUBERNETES]))
  })

  test('asks the candidate to confirm their career items before writing anything', async ({ db }) => {
    const userId = await aCandidateWithWrittenQuestions(db, false)
    unwrap(await draftAnswers(db, userId, { read: stubReader().read, writeExperience: noWriter, writeMotivation: noWriter }))
    expect((await withTenant(db, userId, latestDrafts)).get(questionKey(PYTHON))).toMatchObject({ status: 'no_basis', reason: expect.stringMatching(/Confirm your career items/) })
  })
})

describe('drafting motivation answers, one per job', () => {
  /** Says it wants the job its posting's first line names, quoting that line. */
  function stubMotivator() {
    const postings: string[] = []
    const write: WriteAnswer = async ({ posting }) => {
      const headline = posting?.text.split('\n')[0] ?? ''
      postings.push(headline)
      const value = { covered: true, sentences: [{ text: `I want to join as ${headline}.`, sources: [{ item: posting?.ref ?? '', quote: headline }] }] }
      return ok({ value, traces: [{ ...trace, task: 'application-answers.write-motivation' }] })
    }
    return { write, postings }
  }

  test('writes each job its own draft from its own posting; accepting one answers that job only', async ({ db }) => {
    const userId = await aCandidate(db, { citizenships: ['SV'] })
    await withConfirmedItems(db, userId, [{ organization: 'Acme Corp', title: 'Senior Software Engineer', achievements: ['Built the payments API.'] }])
    const board = await aBoard(db)
    const [backend, platform, canonical] = [await aJob(db, board, 'Backend Engineer'), await aJob(db, board, 'Platform Engineer'), await aJob(db, board, 'Kernel Engineer')]
    await storeForm(db, backend, 'gitlab', [writtenQuestion(WHY)])
    await storeForm(db, platform, 'gitlab', [writtenQuestion(WHY)])
    await storeForm(db, canonical, 'canonical', [writtenQuestion(WHY)])
    for (const job of [backend, platform, canonical]) await makeEligible(db, userId, job)

    const { write, postings } = stubMotivator()
    const deps = { read: stubReader().read, writeExperience: noWriter, writeMotivation: write }
    unwrap(await draftAnswers(db, userId, deps))
    expect(postings.sort()).toEqual([expect.stringMatching(/^Backend Engineer at /), expect.stringMatching(/^Platform Engineer at /)])

    const drafts = await withTenant(db, userId, newestJobDrafts)
    const key = questionKey(WHY)
    expect(drafts.get(jobDraftKey(backend.id, key))).toMatchObject({ method: 'motivation', status: 'drafted', answer: { kind: 'text', text: expect.stringContaining('Backend Engineer') } })
    expect(drafts.get(jobDraftKey(platform.id, key))).toMatchObject({ status: 'drafted', answer: { kind: 'text', text: expect.stringContaining('Platform Engineer') } })
    expect(drafts.get(jobDraftKey(canonical.id, key))).toMatchObject({ status: 'no_basis', reason: expect.stringMatching(/own words/) })
    const open = openQuestions(await readinessForJobs(db, userId, [backend, platform, canonical])).find((q) => q.questionKey === key)
    expect(open).toMatchObject({ draft: null })
    expect(open?.draftsByJob.size).toBe(3)

    await withTenant(db, userId, async (scope) => unwrap(await acceptDraft(scope, { draftId: drafts.get(jobDraftKey(backend.id, key))?.id ?? '' })))
    const blocked = await readinessForJobs(db, userId, [backend, platform])
    const blocks = (jobId: string) => {
      const job = blocked.get(jobId)
      return job?.kind === 'assessed' && job.readiness.blockers.some((b) => b.questionKey === key)
    }
    expect(blocks(backend.id)).toBe(false)
    expect(blocks(platform.id)).toBe(true)

    // Nothing changed for the others: nothing is written, or paid for, again.
    unwrap(await draftAnswers(db, userId, deps))
    expect(postings).toHaveLength(2)
  })
})
