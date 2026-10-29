import { describe, expect } from 'vitest'
import type { Db } from '@/lib/db/client'
import { withTenant, type TenantScope } from '@/lib/db/tenancy'
import { dbTest as test } from '@/lib/db/testing'
import { unwrap } from '@/lib/result'
import { createApplication, listApplications } from '@/modules/applications'
import { getJobRawVersion } from '@/modules/jobs'
import {
  cancelFill, claimFill, endAttempt, expireFills, finishPending, finishRecording, getFill, latestFillForJob, markFilling, markStale, prepareFill, recordReport, recordSubmission,
  renewLease, settleFill, startFill, LEASE_MS, PREPARED_TTL_MS, QUEUED_TTL_MS, type Fill,
} from './service.js'
import { anApplicant, changeAnAnswer, type Applicant } from './test-fixtures.js'
import type { CapturedSubmission } from './types.js'

const T0 = new Date('2026-10-28T12:00:00Z')
const later = (ms: number) => new Date(T0.getTime() + ms)
const WORKER = 'worker-a'
const submission: CapturedSubmission = {
  url: 'https://boards.greenhouse.io/umbrella/jobs/1', capturedAt: T0.toISOString(), payload: { job_application: { first_name: 'Ana' } },
  files: [{ name: 'cv.pdf', size: 1024, sha256: 'a'.repeat(64) }], response: { status: 200 },
}

const as = <T>(db: Db, applicant: Applicant, work: (scope: TenantScope) => Promise<T>) => withTenant(db, applicant.userId, work)

/** A fill the worker has claimed and opened the browser for. */
async function opened(db: Db, applicant: Applicant): Promise<Fill> {
  const prepared = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, T0))
  return as(db, applicant, async (scope) => {
    unwrap(await startFill(scope, prepared.id, prepared.packetHash, T0))
    const claimed = await claimFill(scope, prepared.id, WORKER, T0)
    if (!claimed) throw new Error('expected to claim the fill')
    return unwrap(await markFilling(scope, prepared.id, WORKER))
  })
}

describe('preparing and starting a fill (decision 0016)', () => {
  test('preparing again returns the same fill while it is usable, and a new one once it expired or the packet changed', async ({ db }) => {
    const applicant = await anApplicant(db)
    const first = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, T0))
    expect(first).toMatchObject({ status: 'prepared', jobId: applicant.job.id, rawJobId: unwrap(await getJobRawVersion(db, applicant.job.id)), packetHash: first.packet.fingerprint })
    expect(unwrap(await prepareFill(db, applicant.userId, applicant.job.id, later(60_000))).id).toBe(first.id)
    expect(unwrap(await prepareFill(db, applicant.userId, applicant.job.id, later(PREPARED_TTL_MS + 1))).id).not.toBe(first.id)
    await changeAnAnswer(db, applicant.userId)
    const changed = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, later(PREPARED_TTL_MS + 2)))
    expect(changed.packetHash).not.toBe(first.packetHash)
  })

  test('reads a fill by id, and a job\'s newest fill, for its owner only', async ({ db }) => {
    const applicant = await anApplicant(db)
    const first = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, T0))
    await changeAnAnswer(db, applicant.userId)
    const second = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, later(1_000)))
    await as(db, applicant, async (scope) => {
      expect(await getFill(scope, first.id)).toMatchObject({ id: first.id })
      expect(await latestFillForJob(scope, applicant.job.id)).toMatchObject({ id: second.id })
    })
    const stranger = await anApplicant(db)
    await as(db, stranger, async (scope) => expect(await getFill(scope, first.id)).toBeNull())
  })

  test('the job\'s fill to show is the one holding its slot, even when a newer review exists', async ({ db }) => {
    const applicant = await anApplicant(db)
    const blocking = await opened(db, applicant)
    await changeAnAnswer(db, applicant.userId)
    const newer = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, later(1_000)))
    await as(db, applicant, async (scope) => {
      await expireFills(scope, later(LEASE_MS * 2))
      expect(await latestFillForJob(scope, applicant.job.id)).toMatchObject({ id: blocking.id, status: 'uncertain' })
      unwrap(await settleFill(scope, blocking.id, 'not_submitted'))
      expect(await latestFillForJob(scope, applicant.job.id)).toMatchObject({ id: newer.id })
    })
  })

  test('refuses what the packet refuses: a job the candidate cannot apply to', async ({ db }) => {
    const applicant = await anApplicant(db)
    await as(db, applicant, async (scope) => unwrap(await createApplication(scope, {
      jobId: applicant.job.id, appliedOn: '2026-10-28', resumeId: null, salaryAsked: null, contact: null, notes: null, sourceUrl: null,
    })))
    expect(await prepareFill(db, applicant.userId, applicant.job.id, T0)).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  })

  test('starting takes the reviewed packet only, before it expires, and one fill per job; other prepared fills go stale', async ({ db }) => {
    const applicant = await anApplicant(db)
    const expired = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, later(-PREPARED_TTL_MS - 1)))
    const reviewed = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, T0))
    expect(reviewed.id).not.toBe(expired.id)
    await as(db, applicant, async (scope) => {
      expect(await startFill(scope, reviewed.id, 'another-hash', T0)).toMatchObject({ ok: false, error: { code: 'conflict' } })
      expect(await startFill(scope, expired.id, expired.packetHash, T0)).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
      expect(unwrap(await startFill(scope, reviewed.id, reviewed.packetHash, T0))).toMatchObject({ status: 'queued' })
    })
    const again = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, later(1_000)))
    await as(db, applicant, async (scope) => {
      expect(await startFill(scope, again.id, again.packetHash, later(1_000))).toMatchObject({ ok: false, error: { code: 'conflict' } })
      // Cancelled before the browser opened: the job's slot is free again.
      expect(unwrap(await cancelFill(scope, reviewed.id))).toMatchObject({ status: 'abandoned' })
      expect(unwrap(await startFill(scope, again.id, again.packetHash, later(2_000)))).toMatchObject({ status: 'queued' })
    })
  })
})

describe('the worker: claim, lease and endings (decision 0016)', () => {
  test('a fill is claimed once: a redelivered job finds it no longer queued', async ({ db }) => {
    const applicant = await anApplicant(db)
    const fill = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, T0))
    await as(db, applicant, async (scope) => {
      unwrap(await startFill(scope, fill.id, fill.packetHash, T0))
      expect(await claimFill(scope, fill.id, WORKER, T0)).toMatchObject({ status: 'launching', leaseOwner: WORKER })
      expect(await claimFill(scope, fill.id, 'worker-b', T0)).toBeNull()
    })
  })

  test('only the lease holder renews it; a lease that runs out leaves the fill uncertain, never refilled', async ({ db }) => {
    const applicant = await anApplicant(db)
    const fill = await opened(db, applicant)
    await as(db, applicant, async (scope) => {
      expect(await renewLease(scope, fill.id, WORKER, later(30_000))).toBe(true)
      expect(await renewLease(scope, fill.id, 'worker-b', later(30_000))).toBe(false)
      await expireFills(scope, later(30_000 + LEASE_MS + 1))
      expect(await renewLease(scope, fill.id, WORKER, later(30_000 + LEASE_MS + 2))).toBe(false)
    })
    const after = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, later(LEASE_MS * 3)))
    await as(db, applicant, async (scope) => {
      expect(await startFill(scope, after.id, after.packetHash, later(LEASE_MS * 3))).toMatchObject({ ok: false, error: { code: 'conflict' } })
    })
  })

  test('a fill queued too long without a worker is abandoned: no browser ever opened', async ({ db }) => {
    const applicant = await anApplicant(db)
    const fill = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, T0))
    await as(db, applicant, async (scope) => {
      unwrap(await startFill(scope, fill.id, fill.packetHash, T0))
      await expireFills(scope, later(QUEUED_TTL_MS + 1))
      expect(await claimFill(scope, fill.id, WORKER, later(QUEUED_TTL_MS + 2))).toBeNull()
    })
  })

  test('a review left unstarted past its time is abandoned, and the newest prepared one is kept', async ({ db }) => {
    const applicant = await anApplicant(db)
    const expired = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, T0))
    await changeAnAnswer(db, applicant.userId)
    const fresh = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, later(PREPARED_TTL_MS)))
    await as(db, applicant, async (scope) => {
      await expireFills(scope, later(PREPARED_TTL_MS + 1))
      expect(await getFill(scope, expired.id)).toMatchObject({ status: 'abandoned', error: 'The review expired before it was started.' })
      expect(await getFill(scope, fresh.id)).toMatchObject({ status: 'prepared' })
    })
  })

  test('before the browser opens, a changed packet makes the fill stale and frees the slot', async ({ db }) => {
    const applicant = await anApplicant(db)
    const fill = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, T0))
    await as(db, applicant, async (scope) => {
      unwrap(await startFill(scope, fill.id, fill.packetHash, T0))
      await claimFill(scope, fill.id, WORKER, T0)
      expect(unwrap(await markStale(scope, fill.id, WORKER))).toMatchObject({ status: 'stale', leaseOwner: null })
    })
    const next = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, later(1_000)))
    await as(db, applicant, async (scope) => expect(await startFill(scope, next.id, next.packetHash, later(1_000))).toMatchObject({ ok: true }))
  })

  test('an ending after the browser opened is uncertain unless the network rules a submission out', async ({ db }) => {
    const ruledOut = await anApplicant(db)
    const fill = await opened(db, ruledOut)
    await as(db, ruledOut, async (scope) => {
      unwrap(await recordReport(scope, fill.id, WORKER, { fields: [] }))
      expect(unwrap(await endAttempt(scope, fill.id, WORKER, { ruledOut: true, ending: 'closed', detail: 'The window was closed.' }))).toMatchObject({ status: 'abandoned', leaseOwner: null })
    })
    const notRuledOut = await anApplicant(db)
    const other = await opened(db, notRuledOut)
    await as(db, notRuledOut, async (scope) => {
      expect(unwrap(await endAttempt(scope, other.id, WORKER, { ruledOut: false, ending: 'error', detail: 'The browser crashed.' }))).toMatchObject({ status: 'uncertain', error: 'The browser crashed.' })
      // Another worker cannot end it again.
      expect(await endAttempt(scope, other.id, 'worker-b', { ruledOut: true, ending: 'closed', detail: null })).toMatchObject({ ok: false })
    })
  })
})

describe('recording a submission (decision 0016)', () => {
  test('a confirmed submission is recorded in two writes; between them it keeps the slot, and finishing twice gives one application', async ({ db }) => {
    const applicant = await anApplicant(db)
    const fill = await opened(db, applicant)
    await as(db, applicant, async (scope) => {
      expect(unwrap(await recordSubmission(scope, fill.id, WORKER, { submission, outcome: 'confirmed', evidence: { kind: 'confirmation_page', url: 'https://example.com/thanks', text: 'Thank you' } })))
        .toMatchObject({ status: 'submitted', outcome: 'confirmed', applicationId: null, leaseOwner: null })
    })
    // The second write fails: the application is not recorded, and nothing else may start.
    await expect(as(db, applicant, async (scope) => {
      unwrap(await finishRecording(scope, fill.id, '2026-10-28'))
      throw new Error('crash before commit')
    })).rejects.toThrow('crash before commit')
    expect(await as(db, applicant, listApplications)).toEqual([])
    const blocked = unwrap(await prepareFill(db, applicant.userId, applicant.job.id, later(1_000)))
    await as(db, applicant, async (scope) => expect(await startFill(scope, blocked.id, blocked.packetHash, later(1_000))).toMatchObject({ ok: false, error: { code: 'conflict' } }))

    // Opening the app finishes what the crash left: one application, linked.
    expect(await as(db, applicant, (scope) => finishPending(scope, '2026-10-28'))).toEqual({ recorded: 1, conflicts: 0 })
    expect(await as(db, applicant, (scope) => finishPending(scope, '2026-10-28'))).toEqual({ recorded: 0, conflicts: 0 })
    const application = await as(db, applicant, async (scope) => unwrap(await finishRecording(scope, fill.id, '2026-10-28')))
    expect(application).toMatchObject({ jobId: applicant.job.id, mode: 'assisted', rawJobId: fill.rawJobId, resumeId: applicant.resume.id })
    expect(await as(db, applicant, async (scope) => unwrap(await finishRecording(scope, fill.id, '2026-10-28')))).toMatchObject({ id: application.id })
    expect(await as(db, applicant, listApplications)).toHaveLength(1)
  })

  test('an application this fill did not create conflicts', async ({ db }) => {
    const applicant = await anApplicant(db)
    const fill = await opened(db, applicant)
    await as(db, applicant, async (scope) => {
      unwrap(await recordSubmission(scope, fill.id, WORKER, { submission, outcome: 'confirmed', evidence: { kind: 'confirmation_page', url: 'https://example.com/thanks', text: 'Thank you' } }))
      unwrap(await createApplication(scope, { jobId: applicant.job.id, appliedOn: '2026-10-28', resumeId: null, salaryAsked: null, contact: null, notes: null, sourceUrl: null }))
      expect(await finishRecording(scope, fill.id, '2026-10-28')).toMatchObject({ ok: false, error: { code: 'conflict' } })
    })
  })

  test('a rejected submission fails and frees the slot, keeping what was sent; an unclear one is uncertain', async ({ db }) => {
    const rejected = await anApplicant(db)
    const fill = await opened(db, rejected)
    await as(db, rejected, async (scope) => {
      expect(unwrap(await recordSubmission(scope, fill.id, WORKER, { submission, outcome: 'rejected', evidence: { kind: 'error', status: 422, text: 'Email is invalid' } })))
        .toMatchObject({ status: 'failed', outcome: 'rejected', submission })
    })
    const unclear = await anApplicant(db)
    const other = await opened(db, unclear)
    await as(db, unclear, async (scope) => {
      expect(unwrap(await recordSubmission(scope, other.id, WORKER, { submission, outcome: 'unknown', evidence: { kind: 'error', status: null, text: 'No response' } })))
        .toMatchObject({ status: 'uncertain', outcome: 'unknown' })
    })
  })

  test('the owner settles an uncertain fill: a reported submission keeps any captured request; "I didn\'t" frees the slot', async ({ db }) => {
    const captured = await anApplicant(db)
    const fill = await opened(db, captured)
    await as(db, captured, async (scope) => {
      unwrap(await recordSubmission(scope, fill.id, WORKER, { submission, outcome: 'unknown', evidence: { kind: 'error', status: null, text: 'No response' } }))
      const settled = unwrap(await settleFill(scope, fill.id, 'submitted', T0))
      expect(settled).toMatchObject({ status: 'submitted', outcome: 'user_reported', submission, outcomeEvidence: { kind: 'owner_report' } })
      expect(unwrap(await finishRecording(scope, fill.id, '2026-10-28'))).toMatchObject({ mode: 'assisted' })
    })
    const nothing = await anApplicant(db)
    const other = await opened(db, nothing)
    await as(db, nothing, async (scope) => {
      unwrap(await endAttempt(scope, other.id, WORKER, { ruledOut: false, ending: 'error', detail: 'The browser crashed.' }))
      expect(unwrap(await settleFill(scope, other.id, 'submitted', T0))).toMatchObject({ outcome: 'user_reported', submission: null })
    })
    const notSent = await anApplicant(db)
    const third = await opened(db, notSent)
    await as(db, notSent, async (scope) => {
      unwrap(await endAttempt(scope, third.id, WORKER, { ruledOut: false, ending: 'timeout', detail: null }))
      expect(unwrap(await settleFill(scope, third.id, 'not_submitted', T0))).toMatchObject({ status: 'abandoned' })
    })
    const next = unwrap(await prepareFill(db, notSent.userId, notSent.job.id, later(1_000)))
    await as(db, notSent, async (scope) => expect(await startFill(scope, next.id, next.packetHash, later(1_000))).toMatchObject({ ok: true }))
  })
})
