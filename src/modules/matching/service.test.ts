import { describe, expect } from 'vitest'
import { withTenant } from '@/lib/db/tenancy'
import { dbTest as test } from '@/lib/db/testing'
import { err, unwrap } from '@/lib/result'
import { saveCandidateProfile } from '@/modules/profiles'
import type { ExtractRequirements } from './extract.js'
import { assessMatchForUser, enqueueMatchesForUser, getMatch, getMatchCard } from './service.js'
import { aBoard, aCandidate, aPosting, assessEligibility, publish, seeker, stubExtract, withCareerItems } from './test-fixtures.js'

describe('matching a job for a candidate', () => {
  test('stores every dimension with its evidence, prompt version and model, and no score', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const userId = await aCandidate(db)
    await withCareerItems(db, userId, [{ organization: 'FullStack Labs', title: 'Senior Software Engineer', technologies: ['TypeScript'], startedOn: '2019-01', endedOn: '2026-01' }])
    await assessEligibility(db, userId, job.id)
    const { extract, calls } = stubExtract()

    expect(unwrap(await assessMatchForUser(db, { userId, jobId: job.id }, extract))).toEqual({ kind: 'assessed' })
    expect(calls[0]).toContain('Title: Senior Backend Engineer')
    const match = await withTenant(db, userId, (scope) => getMatch(scope, job.id))
    expect(match).toMatchObject({ promptVersion: 1, model: 'fake-model', salaryCompatibility: 'unknown' })
    expect(match?.dimensions.requiredSkills).toMatchObject({ status: 'meets', findings: [{ requirement: 'TypeScript', status: 'met' }] })
    expect(match?.missingRequirements).toEqual([expect.objectContaining({ requirement: 'Kubernetes', status: 'missing' })])
    expect(Object.keys(match ?? {})).not.toContain('score')
  })

  test('does not match a job eligibility rejected, or one it has not assessed', async ({ db }) => {
    const board = await aBoard(db)
    const rejected = await publish(db, board, aPosting())
    const unassessed = await publish(db, board, aPosting({ title: 'Staff Platform Engineer' }))
    const userId = await aCandidate(db)
    await assessEligibility(db, userId, rejected.id, { isOpen: false })
    const { extract, calls } = stubExtract()

    expect(unwrap(await assessMatchForUser(db, { userId, jobId: rejected.id }, extract))).toEqual({ kind: 'skipped', reason: 'not_eligible' })
    expect(unwrap(await assessMatchForUser(db, { userId, jobId: unassessed.id }, extract))).toEqual({ kind: 'skipped', reason: 'not_assessed' })
    expect(calls).toHaveLength(0)
  })

  test('reads a posting once for every candidate, and does nothing when no input changed', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const { extract, calls } = stubExtract()
    const users = [await aCandidate(db), await aCandidate(db)]
    for (const userId of users) {
      await assessEligibility(db, userId, job.id)
      unwrap(await assessMatchForUser(db, { userId, jobId: job.id }, extract))
    }
    expect(calls).toHaveLength(1)
    expect(unwrap(await assessMatchForUser(db, { userId: users[0]!, jobId: job.id }, extract))).toEqual({ kind: 'fresh' })
  })

  test('re-matches without re-reading when the career record or a matching setting changes', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const userId = await aCandidate(db)
    await assessEligibility(db, userId, job.id)
    const { extract, calls } = stubExtract()
    unwrap(await assessMatchForUser(db, { userId, jobId: job.id }, extract))

    await withCareerItems(db, userId, [{ technologies: ['Kubernetes'] }])
    expect(unwrap(await assessMatchForUser(db, { userId, jobId: job.id }, extract))).toEqual({ kind: 'assessed' })
    expect((await withTenant(db, userId, (scope) => getMatch(scope, job.id)))?.dimensions.preferredSkills.status).toBe('meets')

    await withTenant(db, userId, async (scope) => unwrap(await saveCandidateProfile(scope, { ...seeker, spokenLanguages: ['es'] })))
    expect(unwrap(await assessMatchForUser(db, { userId, jobId: job.id }, extract))).toEqual({ kind: 'assessed' })
    expect(calls).toHaveLength(1)
  })

  test('a quota error writes nothing; an unreadable posting is still compared on its structured fields', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const userId = await aCandidate(db)
    await assessEligibility(db, userId, job.id)
    const quota: ExtractRequirements = async () => err({ code: 'rate_limited', message: 'gemini: HTTP 429', traces: [] })
    expect(await assessMatchForUser(db, { userId, jobId: job.id }, quota)).toMatchObject({ ok: false, error: { code: 'rate_limited' } })
    expect(await withTenant(db, userId, (scope) => getMatch(scope, job.id))).toBeNull()

    const refused: ExtractRequirements = async () => err({ code: 'validation_failed', message: 'bad output twice', traces: [] })
    expect(unwrap(await assessMatchForUser(db, { userId, jobId: job.id }, refused))).toEqual({ kind: 'assessed' })
    const match = await withTenant(db, userId, (scope) => getMatch(scope, job.id))
    expect(match).toMatchObject({ requirementsId: null, promptVersion: null, dimensions: { requiredSkills: { status: 'unknown' }, seniority: { status: 'meets' } } })
    expect(match?.concerns).toContain('The posting’s requirements could not be read automatically.')
  })

  test('drops a stored requirement whose quote is not in the posting', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const userId = await aCandidate(db)
    await assessEligibility(db, userId, job.id)
    const { extract } = stubExtract({
      skills: [{ name: 'Rust', importance: 'required', minYears: null, quote: 'Expert in Rust' }],
      experience: null, languages: [], other: [],
    })
    unwrap(await assessMatchForUser(db, { userId, jobId: job.id }, extract))
    expect((await withTenant(db, userId, (scope) => getMatch(scope, job.id)))?.dimensions.requiredSkills.status).toBe('not_stated')
  })

  test('isolates matches between candidates', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting())
    const [owner, other] = [await aCandidate(db), await aCandidate(db)]
    await assessEligibility(db, owner!, job.id)
    unwrap(await assessMatchForUser(db, { userId: owner!, jobId: job.id }, stubExtract().extract))
    expect(await withTenant(db, other!, (scope) => getMatch(scope, job.id))).toBeNull()
  })
})

describe('the job card', () => {
  test('explains the stored match, including requirements it did not compare', async ({ db }) => {
    const job = await publish(db, await aBoard(db), aPosting({ content: '&lt;p&gt;You have 5+ years with TypeScript. BS in Computer Science.&lt;/p&gt;' }))
    const userId = await aCandidate(db)
    await assessEligibility(db, userId, job.id)
    const { extract } = stubExtract({
      skills: [{ name: 'TypeScript', importance: 'required', minYears: 5, quote: 'You have 5+ years with TypeScript.' }],
      experience: null, languages: [], other: [{ text: 'CS degree', importance: 'required', quote: 'BS in Computer Science' }],
    })
    unwrap(await assessMatchForUser(db, { userId, jobId: job.id }, extract))

    const card = await getMatchCard(db, userId, job.id)
    expect(card?.sections.map((s) => s.headline)).toEqual([
      'Required skills: 0 of 1 shown on your record',
      'Role: “Senior Backend Engineer” is close to your target “Senior Software Engineer”',
      'Seniority: Senior role; you target senior',
      'Not compared: 1 other requirement',
    ])
    expect(await getMatchCard(db, await aCandidate(db), job.id)).toBeNull()
  })
})

describe('re-matching a candidate', () => {
  test('queues every open job eligibility did not reject', async ({ db }) => {
    const board = await aBoard(db)
    const open = await publish(db, board, aPosting())
    const rejected = await publish(db, board, aPosting({ title: 'Staff Platform Engineer' }))
    const userId = await aCandidate(db)
    await assessEligibility(db, userId, open.id)
    await assessEligibility(db, userId, rejected.id, { isOpen: false })

    const queued: string[] = []
    expect(await enqueueMatchesForUser(db, userId, async (payload) => { queued.push(payload.jobId) })).toBe(1)
    expect(queued).toEqual([open.id])
  })
})
