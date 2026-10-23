import { eq } from 'drizzle-orm'
import { describe, expect } from 'vitest'
import { withTenant } from '@/lib/db/tenancy'
import { dbTest as test } from '@/lib/db/testing'
import { err, unwrap } from '@/lib/result'
import { saveCandidateProfile } from '@/modules/profiles'
import type { ExtractClaims } from './extract.js'
import { eligibilityAssessments } from './schema.js'
import { assessJobForUser, enqueueAssessmentsForJob, enqueueAssessmentsForUser, getAssessment, listAssessments, reviewGroup, setUserOverride } from './service.js'
import { aBoard, aCandidate, aPosting, latamClaims, publish, remoteSeeker, stubExtract } from './test-fixtures.js'

describe('assessing a job for a candidate', () => {
  test('stores the verdict with its evidence, prompt version, model and claims', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const userId = await aCandidate(db)
    const { extract, calls } = stubExtract()

    expect(unwrap(await assessJobForUser(db, { userId, jobId: job.id }, extract))).toEqual({ kind: 'assessed', verdict: 'eligible' })
    expect(calls[0]).toContain('Title: Senior Backend Engineer')
    const stored = await withTenant(db, userId, (scope) => getAssessment(scope, job.id))
    expect(stored).toMatchObject({ verdict: 'eligible', confidence: 0.8, stage: 'extracted', promptVersion: 3, model: 'fake-model', userOverride: null })
    expect(stored?.claimsId).not.toBeNull()
  })

  test('never rejects on a salary read from the posting text, even below a hard floor (decision 0011)', async ({ db }) => {
    const content = '&lt;p&gt;This role is remote across LATAM.&lt;/p&gt;&lt;p&gt;The base salary range for this role is $100,000 - $120,000 USD.&lt;/p&gt;'
    const job = await publish(db, await aBoard(db), aPosting({ content }))
    expect(job.salaryQuote).not.toBeNull()
    const userId = await aCandidate(db, { ...remoteSeeker, salaryFloorMinor: 20_000_000, constraintModes: { ...remoteSeeker.constraintModes, salaryFloorMinor: 'hard' } })
    expect(unwrap(await assessJobForUser(db, { userId, jobId: job.id }, stubExtract().extract))).toEqual({ kind: 'assessed', verdict: 'eligible' })
  })

  test('extracts a posting once and reuses its claims for every candidate', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const { extract, calls } = stubExtract()
    for (const userId of [await aCandidate(db), await aCandidate(db)]) unwrap(await assessJobForUser(db, { userId, jobId: job.id }, extract))
    expect(calls).toHaveLength(1)
  })

  test('does nothing when neither the job nor the profile has changed', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const userId = await aCandidate(db)
    const { extract, calls } = stubExtract()
    unwrap(await assessJobForUser(db, { userId, jobId: job.id }, extract))
    expect(unwrap(await assessJobForUser(db, { userId, jobId: job.id }, extract))).toEqual({ kind: 'fresh' })
    expect(calls).toHaveLength(1)
  })

  test('re-reads the posting when its text changes', async ({ db }) => {
    const board = await aBoard(db)
    const posting = aPosting()
    const job = await publish(db, board, posting)
    const userId = await aCandidate(db)
    const { extract, calls } = stubExtract()
    unwrap(await assessJobForUser(db, { userId, jobId: job.id }, extract))
    await publish(db, board, { ...posting, content: '&lt;p&gt;This role is remote across LATAM. Spanish required.&lt;/p&gt;' })
    expect(unwrap(await assessJobForUser(db, { userId, jobId: job.id }, extract))).toMatchObject({ kind: 'assessed' })
    expect(calls).toHaveLength(2)
  })

  test('re-assesses after a profile change without reading the posting again, and keeps the user override', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const userId = await aCandidate(db)
    const { extract, calls } = stubExtract()
    unwrap(await assessJobForUser(db, { userId, jobId: job.id }, extract))
    await withTenant(db, userId, async (scope) => {
      await scope.db.update(eligibilityAssessments).set({ userOverride: 'eligible', overrideReason: 'I asked the recruiter' })
        .where(eq(eligibilityAssessments.jobId, job.id))
      unwrap(await saveCandidateProfile(scope, { ...remoteSeeker, allowedRegions: ['emea'], country: 'ES' }))
    })

    expect(unwrap(await assessJobForUser(db, { userId, jobId: job.id }, extract))).toEqual({ kind: 'assessed', verdict: 'not_eligible' })
    expect(calls).toHaveLength(1)
    expect(await withTenant(db, userId, (scope) => getAssessment(scope, job.id)))
      .toMatchObject({ verdict: 'not_eligible', userOverride: 'eligible', overrideReason: 'I asked the recruiter' })
  })

  test('a quota error writes nothing so the queue can retry; an unreadable posting is needs_review', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const userId = await aCandidate(db)
    const quota: ExtractClaims = async () => err({ code: 'rate_limited', message: 'gemini: HTTP 429', traces: [] })
    expect(await assessJobForUser(db, { userId, jobId: job.id }, quota)).toMatchObject({ ok: false, error: { code: 'rate_limited' } })
    expect(await withTenant(db, userId, (scope) => getAssessment(scope, job.id))).toBeNull()

    const refused: ExtractClaims = async () => err({ code: 'validation_failed', message: 'bad output twice', traces: [] })
    expect(unwrap(await assessJobForUser(db, { userId, jobId: job.id }, refused))).toEqual({ kind: 'assessed', verdict: 'needs_review' })
    expect(await withTenant(db, userId, (scope) => getAssessment(scope, job.id)))
      .toMatchObject({ verdict: 'needs_review', reasons: { openQuestions: [expect.stringContaining('could not be read')] } })
  })

  test('skips candidates without a profile', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const { extract, calls } = stubExtract()
    expect(unwrap(await assessJobForUser(db, { userId: await aCandidate(db, null), jobId: job.id }, extract)))
      .toEqual({ kind: 'skipped', reason: 'no_profile' })
    expect(calls).toHaveLength(0)
  })

  test("a candidate cannot read another candidate's assessment", async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const owner = await aCandidate(db)
    unwrap(await assessJobForUser(db, { userId: owner, jobId: job.id }, stubExtract(latamClaims).extract))
    expect(await withTenant(db, await aCandidate(db), (scope) => getAssessment(scope, job.id))).toBeNull()
  })
})

describe('queueing assessments', () => {
  const collector = () => {
    const queued: { userId: string; jobId: string; key: string }[] = []
    return { queued, enqueue: async (payload: { userId: string; jobId: string }, key: string) => { queued.push({ ...payload, key }) } }
  }

  test('a normalized job is queued for every candidate with a profile', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const [withProfile, withoutProfile] = [await aCandidate(db), await aCandidate(db, null)]
    const { queued, enqueue } = collector()
    await enqueueAssessmentsForJob(db, job, enqueue)
    expect(queued.some((q) => q.userId === withProfile && q.jobId === job.id)).toBe(true)
    expect(queued.some((q) => q.userId === withoutProfile)).toBe(false)
  })

  test("a profile change queues the candidate's open jobs under new keys", async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const userId = await aCandidate(db)
    const before = collector()
    await enqueueAssessmentsForUser(db, userId, before.enqueue)
    await withTenant(db, userId, async (scope) => unwrap(await saveCandidateProfile(scope, { ...remoteSeeker, willingToRelocate: true })))
    const after = collector()
    await enqueueAssessmentsForUser(db, userId, after.enqueue)

    const keyFor = (list: { jobId: string; key: string }[]) => list.find((q) => q.jobId === job.id)?.key
    expect(keyFor(before.queued)).toContain(`${userId}@${job.id}@`)
    expect(keyFor(after.queued)).not.toBe(keyFor(before.queued))
    expect(keyFor(after.queued)).not.toContain(':')
  })
})

describe('the user\'s own verdict', () => {
  test('sets and clears an override, keeping the engine\'s verdict, and lists every assessment', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const userId = await aCandidate(db, { ...remoteSeeker, allowedRegions: ['emea'], country: 'ES' })
    expect(unwrap(await assessJobForUser(db, { userId, jobId: job.id }, stubExtract().extract))).toEqual({ kind: 'assessed', verdict: 'not_eligible' })

    const overridden = await withTenant(db, userId, (scope) => setUserOverride(scope, { jobId: job.id, verdict: 'eligible', reason: '  The recruiter said LATAM is fine.  ' }))
    expect(unwrap(overridden)).toMatchObject({ verdict: 'not_eligible', userOverride: 'eligible', overrideReason: 'The recruiter said LATAM is fine.' })
    const [listed] = await withTenant(db, userId, listAssessments)
    expect(listed && reviewGroup(listed)).toBe('can_apply')

    unwrap(await withTenant(db, userId, (scope) => setUserOverride(scope, { jobId: job.id, verdict: null, reason: null })))
    expect(await withTenant(db, userId, (scope) => getAssessment(scope, job.id))).toMatchObject({ userOverride: null, overrideReason: null })
  })

  test('an override needs an assessment, and stays the candidate\'s own', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const [owner, other] = [await aCandidate(db), await aCandidate(db)]
    expect(await withTenant(db, owner, (scope) => setUserOverride(scope, { jobId: job.id, verdict: 'eligible', reason: null }))).toMatchObject({ ok: false, error: { code: 'not_found' } })
    unwrap(await assessJobForUser(db, { userId: owner, jobId: job.id }, stubExtract().extract))
    expect(await withTenant(db, other, (scope) => setUserOverride(scope, { jobId: job.id, verdict: 'eligible', reason: null }))).toMatchObject({ ok: false, error: { code: 'not_found' } })
    expect(await withTenant(db, other, listAssessments)).toEqual([])
  })
})
