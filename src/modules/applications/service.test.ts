import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect } from 'vitest'
import type { Db } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { dbTest as test } from '@/lib/db/testing'
import { unwrap } from '@/lib/result'
import { getJob, getJobRawVersion, getJobUserState } from '@/modules/jobs'
import { uploadResume } from '@/modules/resumes'
import { applications } from './schema.js'
import {
  changeStatus, createApplication, getApplication, getApplicationForJob,
  listApplications, postingAsApplied, updateApplication,
} from './service.js'
import { aCandidate, aJob, aPosting, publish, takeDown } from './test-fixtures.js'
import type { NewApplication } from './types.js'

const inputFor = (jobId: string): NewApplication => ({
  jobId, appliedOn: '2020-01-01', resumeId: null, salaryAsked: null,
  contact: null, notes: null, sourceUrl: null,
})
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

async function loggedApplication(db: Db) {
  const { board, job } = await aJob(db)
  const userId = await aCandidate(db)
  const application = unwrap(await withTenant(db, userId, (scope) => createApplication(scope, inputFor(job.id))))
  return { board, job, userId, application }
}

let storageRoot: string
let pdf: Uint8Array
beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'applications-test-'))
  pdf = await readFile(new URL('../resumes/__fixtures__/synthetic-resume.pdf', import.meta.url))
})
afterAll(async () => { await rm(storageRoot, { recursive: true, force: true }) })

describe('creating applications', () => {
  test('pins the posting, logs the first event and marks the job applied together', async ({ db }) => {
    const { job, userId, application } = await loggedApplication(db)
    expect(application).toMatchObject({
      userId, jobId: job.id, status: 'applied', appliedOn: '2020-01-01',
      rawJobId: unwrap(await getJobRawVersion(db, job.id)), sourceUrl: job.applyUrl, salaryAsked: null,
    })
    await withTenant(db, userId, async (scope) => {
      const details = unwrap(await getApplication(scope, application.id))
      expect(details.events).toHaveLength(1)
      expect(details.events[0]).toMatchObject({ fromStatus: null, toStatus: 'applied', occurredOn: '2020-01-01', note: null })
      expect(unwrap(await getJobUserState(scope, job.id)).state).toBe('applied')
    })
  })

  test('stores the chosen source, resume, contact, salary and notes', async ({ db }) => {
    const { job } = await aJob(db)
    const userId = await aCandidate(db)
    await withTenant(db, userId, async (scope) => {
      const resume = unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot }))
      const input = {
        ...inputFor(job.id), resumeId: resume.id, sourceUrl: 'https://example.com/apply',
        contact: { name: 'Test recruiter', email: 'recruiter@example.com' },
        salaryAsked: { amountMinor: 9_000_050, currency: 'USD' }, notes: 'Sent the requested version.',
      }
      expect(unwrap(await createApplication(scope, input))).toMatchObject(input)
    })
  })

  test('refuses a duplicate without adding history or changing its original details', async ({ db }) => {
    const { job, userId, application } = await loggedApplication(db)
    await withTenant(db, userId, async (scope) => {
      expect(await createApplication(scope, inputFor(job.id))).toEqual({
        ok: false, error: { code: 'conflict', message: 'You already logged an application for this job.' },
      })
      expect(unwrap(await getApplication(scope, application.id)).events).toHaveLength(1)
    })
  })

  test('refuses a missing job and a future application date without writing anything', async ({ db }) => {
    const { job } = await aJob(db)
    const userId = await aCandidate(db)
    await withTenant(db, userId, async (scope) => {
      expect(await createApplication(scope, inputFor(randomUUID()))).toMatchObject({ ok: false, error: { code: 'not_found' } })
      expect(await createApplication(scope, { ...inputFor(job.id), appliedOn: tomorrow() })).toEqual({
        ok: false, error: { code: 'invalid_input', message: 'The application date cannot be in the future.' },
      })
      expect(await listApplications(scope)).toEqual([])
      expect(await getJobUserState(scope, job.id)).toMatchObject({ ok: false, error: { code: 'not_found' } })
    })
  })

  test('refuses a resume belonging to another candidate and a missing resume', async ({ db }) => {
    const { job } = await aJob(db)
    const owner = await aCandidate(db)
    const userId = await aCandidate(db)
    const resume = unwrap(await withTenant(db, owner, (scope) => uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot })))
    await withTenant(db, userId, async (scope) => {
      for (const resumeId of [resume.id, randomUUID()]) {
        expect(await createApplication(scope, { ...inputFor(job.id), resumeId })).toEqual({
          ok: false, error: { code: 'not_found', message: 'That resume version was not found.' },
        })
      }
      expect(await listApplications(scope)).toEqual([])
    })
  })
})

describe('application stages and details', () => {
  test('allows reopening a rejection and keeps each dated move and note', async ({ db }) => {
    const { userId, application } = await loggedApplication(db)
    await withTenant(db, userId, async (scope) => {
      const moves = [
        { to: 'interviewing', occurredOn: '2020-01-02', note: 'First interview.' },
        { to: 'rejected', occurredOn: '2020-01-03', note: 'Role filled.' },
        { to: 'interviewing', occurredOn: '2020-01-04', note: 'Another opening.' },
      ] satisfies Omit<Parameters<typeof changeStatus>[1], 'applicationId'>[]
      for (const move of moves) {
        expect(unwrap(await changeStatus(scope, { applicationId: application.id, ...move })).status).toBe(move.to)
      }
      const { events } = unwrap(await getApplication(scope, application.id))
      expect(events.map(({ fromStatus, toStatus, occurredOn, note }) => [fromStatus, toStatus, occurredOn, note])).toEqual([
        [null, 'applied', '2020-01-01', null],
        ['applied', 'interviewing', '2020-01-02', 'First interview.'],
        ['interviewing', 'rejected', '2020-01-03', 'Role filled.'],
        ['rejected', 'interviewing', '2020-01-04', 'Another opening.'],
      ])
    })
  })

  test('refuses an unchanged stage, a future move, and a move before applying', async ({ db }) => {
    const { userId, application } = await loggedApplication(db)
    await withTenant(db, userId, async (scope) => {
      const base = { applicationId: application.id, to: 'interviewing', occurredOn: application.appliedOn, note: null } satisfies Parameters<typeof changeStatus>[1]
      expect(await changeStatus(scope, { ...base, to: 'applied' })).toEqual({ ok: false, error: { code: 'invalid_input', message: 'It is already applied.' } })
      expect(await changeStatus(scope, { ...base, occurredOn: tomorrow() })).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
      expect(await changeStatus(scope, { ...base, occurredOn: '2019-12-31' })).toEqual({
        ok: false, error: { code: 'invalid_input', message: 'A change cannot happen before the application was sent.' },
      })
      expect(unwrap(await getApplication(scope, application.id)).events).toHaveLength(1)
    })
  })

  test('edits details without changing the stage, original event, or posting', async ({ db }) => {
    const { userId, application } = await loggedApplication(db)
    await withTenant(db, userId, async (scope) => {
      unwrap(await changeStatus(scope, { applicationId: application.id, to: 'rejected', occurredOn: '2020-01-03', note: null }))
      const before = unwrap(await getApplication(scope, application.id))
      const edit = {
        appliedOn: '2020-01-02', resumeId: null, notes: 'Followed up.', contact: { name: 'Test recruiter' },
        salaryAsked: { amountMinor: 9_000_050, currency: 'USD' }, outcomeReason: 'Role filled internally.',
      }
      expect(unwrap(await updateApplication(scope, application.id, edit))).toMatchObject({
        ...edit, status: 'rejected', sourceUrl: application.sourceUrl, rawJobId: application.rawJobId,
      })
      expect(unwrap(await getApplication(scope, application.id)).events).toEqual(before.events)
    })
  })

  test('an edit cannot move the application date after a stage change already recorded', async ({ db }) => {
    const { userId, application } = await loggedApplication(db)
    await withTenant(db, userId, async (scope) => {
      unwrap(await changeStatus(scope, { applicationId: application.id, to: 'interviewing', occurredOn: '2020-01-03', note: null }))
      const edit = { appliedOn: '2020-01-04', resumeId: null, notes: null, contact: null, salaryAsked: null, outcomeReason: null }
      expect(await updateApplication(scope, application.id, edit)).toEqual({
        ok: false, error: { code: 'invalid_input', message: 'The application date cannot be after a stage change already recorded (2020-01-03).' },
      })
      expect(unwrap(await updateApplication(scope, application.id, { ...edit, appliedOn: '2020-01-03' })).appliedOn).toBe('2020-01-03')
    })
  })

  test('edits validate the date and resume and can clear optional details', async ({ db }) => {
    const { userId, application } = await loggedApplication(db)
    const owner = await aCandidate(db)
    const resume = unwrap(await withTenant(db, owner, (scope) => uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot })))
    await withTenant(db, userId, async (scope) => {
      const edit = { appliedOn: application.appliedOn, resumeId: null, notes: null, contact: null, salaryAsked: null, outcomeReason: null }
      expect(await updateApplication(scope, application.id, { ...edit, appliedOn: tomorrow() })).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
      expect(await updateApplication(scope, application.id, { ...edit, resumeId: resume.id })).toMatchObject({ ok: false, error: { code: 'not_found' } })
      expect(unwrap(await updateApplication(scope, application.id, edit))).toMatchObject(edit)
      expect(unwrap(await getApplication(scope, application.id)).events).toHaveLength(1)
    })
  })
})

describe('reading applications', () => {
  test('orders by the latest event day, even when the most recently recorded move was backdated', async ({ db }) => {
    const { job: first } = await aJob(db)
    const { job: second } = await aJob(db)
    const userId = await aCandidate(db)
    await withTenant(db, userId, async (scope) => {
      const older = unwrap(await createApplication(scope, inputFor(first.id)))
      const newer = unwrap(await createApplication(scope, { ...inputFor(second.id), appliedOn: '2020-01-02' }))
      await changeStatus(scope, { applicationId: older.id, to: 'interviewing', occurredOn: '2020-01-04', note: null })
      await changeStatus(scope, { applicationId: older.id, to: 'rejected', occurredOn: '2020-01-03', note: null })
      expect((await listApplications(scope)).map(({ id, lastActivityOn }) => [id, lastActivityOn])).toEqual([
        [older.id, '2020-01-04'], [newer.id, '2020-01-02'],
      ])
      expect(unwrap(await getApplication(scope, older.id)).events.map((event) => event.occurredOn))
        .toEqual(['2020-01-01', '2020-01-03', '2020-01-04'])
    })
  })

  test('breaks equal activity dates by creation time, newest first', async ({ db }) => {
    const { job: first } = await aJob(db)
    const { job: second } = await aJob(db)
    const userId = await aCandidate(db)
    await withTenant(db, userId, async (scope) => {
      const older = unwrap(await createApplication(scope, inputFor(first.id)))
      const newer = unwrap(await createApplication(scope, inputFor(second.id)))
      await scope.db.update(applications).set({ createdAt: new Date('2020-01-01T00:00:00Z') })
        .where(eq(applications.userId, userId))
      await scope.db.update(applications).set({ createdAt: new Date('2020-01-02T00:00:00Z') })
        .where(eq(applications.id, newer.id))
      expect((await listApplications(scope)).map((application) => application.id)).toEqual([newer.id, older.id])
    })
  })

  test('isolates reads and writes while allowing each candidate to apply to the same job', async ({ db }) => {
    const { userId, job, application } = await loggedApplication(db)
    const other = await aCandidate(db)
    await withTenant(db, other, async (scope) => {
      expect(await listApplications(scope)).toEqual([])
      expect(await getApplicationForJob(scope, job.id)).toBeNull()
      for (const applicationId of [application.id, randomUUID()]) {
        expect(await getApplication(scope, applicationId)).toMatchObject({ ok: false, error: { code: 'not_found' } })
        expect(await changeStatus(scope, { applicationId, to: 'rejected', occurredOn: application.appliedOn, note: null }))
          .toMatchObject({ ok: false, error: { code: 'not_found' } })
        expect(await updateApplication(scope, applicationId, { ...inputFor(job.id), outcomeReason: null }))
          .toMatchObject({ ok: false, error: { code: 'not_found' } })
      }
      expect(unwrap(await createApplication(scope, inputFor(job.id))).userId).toBe(other)
    })
    await withTenant(db, userId, async (scope) => {
      expect((await listApplications(scope)).map((entry) => entry.id)).toEqual([application.id])
      expect(await getApplicationForJob(scope, job.id)).toEqual(application)
    })
  })

  test('replays the original title and full description after the posting changes and goes offline', async ({ db }) => {
    const posting = aPosting({ title: 'Original title', content: '&lt;p&gt;Original full description.&lt;/p&gt;' })
    const { board, job } = await aJob(db, posting)
    const userId = await aCandidate(db)
    const application = unwrap(await withTenant(db, userId, (scope) => createApplication(scope, inputFor(job.id))))
    await publish(db, board, [{ ...posting, title: 'Updated title', content: '&lt;p&gt;Changed requirements.&lt;/p&gt;' }], new Date(Date.now() + 500))
    await takeDown(db, board)
    expect(unwrap(await getJob(db, job.id))).toMatchObject({ title: 'Updated title' })
    expect(unwrap(await getJob(db, job.id)).closedAt).not.toBeNull()
    expect(unwrap(await postingAsApplied(db, application)).job).toMatchObject({ title: 'Original title', description: 'Original full description.' })
  })
})
