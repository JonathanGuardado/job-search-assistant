import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { withTenant, type TenantScope } from '@/lib/db/tenancy'
import { domainError, err, ok, type Result } from '@/lib/result'
import { buildPacket } from '@/modules/application-answers'
import { createApplication, getApplication, type Application } from '@/modules/applications'
import { applicationFills } from './schema.js'
import { IN_PROGRESS, type CapturedSubmission, type FillOutcome, type FillReport, type FillStatus, type OutcomeEvidence } from './types.js'

/*
 * The record of each fill (decision 0016). Every change is one short write, checked against
 * the status it expects and, for the worker, the lease it holds: the browser never waits
 * inside a transaction. A fill that cannot rule out a submission ends uncertain.
 */

export type Fill = typeof applicationFills.$inferSelect

/** How long a worker's lease lasts; it renews every 30 seconds while the browser is open. */
export const LEASE_MS = 90_000
/** How long a reviewed packet can be started. */
export const PREPARED_TTL_MS = 24 * 3_600_000
/** How long a started fill waits for a worker before it is abandoned: no browser opened. */
export const QUEUED_TTL_MS = 10 * 60_000

/** The browser may be open: the worker holds these with its lease. */
const OPEN: readonly FillStatus[] = ['launching', 'filling', 'waiting']

const byId = (scope: TenantScope, fillId: string) => and(eq(applicationFills.userId, scope.userId), eq(applicationFills.id, fillId))
const held = (scope: TenantScope, fillId: string, worker: string, statuses: readonly FillStatus[]) =>
  and(byId(scope, fillId), eq(applicationFills.leaseOwner, worker), inArray(applicationFills.status, statuses))
const released = { leaseOwner: null, leaseExpiresAt: null, updatedAt: sql`now()` }
const notHeld = () => err(domainError('conflict', 'This fill is not held by this worker in that state.'))

/**
 * A fill for the owner to review: the packet as it stands, pinned. The same packet prepared
 * again returns the same fill while it can still be started.
 */
export async function prepareFill(db: Db, userId: string, jobId: string, now = new Date()): Promise<Result<Fill>> {
  const packet = await buildPacket(db, userId, jobId)
  if (!packet.ok) return packet
  return withTenant(db, userId, async (scope) => {
    const [usable] = await scope.db.select().from(applicationFills).where(and(
      eq(applicationFills.userId, userId), eq(applicationFills.jobId, jobId), eq(applicationFills.status, 'prepared'),
      eq(applicationFills.packetHash, packet.value.fingerprint), gt(applicationFills.createdAt, new Date(now.getTime() - PREPARED_TTL_MS)),
    )).orderBy(desc(applicationFills.createdAt)).limit(1)
    if (usable) return ok(usable)
    const [row] = await scope.db.insert(applicationFills).values({
      userId, jobId, rawJobId: packet.value.rawJobId, formFingerprint: packet.value.formFingerprint, packet: packet.value,
      packetHash: packet.value.fingerprint, status: 'prepared', createdAt: now, updatedAt: now,
    }).returning()
    if (!row) throw new Error('fill insert returned no row')
    return ok(row)
  })
}

export async function getFill(scope: TenantScope, fillId: string): Promise<Fill | null> {
  const [row] = await scope.db.select().from(applicationFills).where(byId(scope, fillId))
  return row ?? null
}

/** The fills that hold the job's slot: the same condition as the unique index on application_fills. */
const holdsSlot = () => or(inArray(applicationFills.status, IN_PROGRESS), and(eq(applicationFills.status, 'submitted'), isNull(applicationFills.applicationId)))

/**
 * What the job page shows: the fill holding the job's slot, so one that is running or waits
 * for the owner's word is never hidden behind a newer review; otherwise the newest fill.
 */
export async function latestFillForJob(scope: TenantScope, jobId: string): Promise<Fill | null> {
  const [row] = await scope.db.select().from(applicationFills)
    .where(and(eq(applicationFills.userId, scope.userId), eq(applicationFills.jobId, jobId)))
    .orderBy(desc(sql`${holdsSlot()}`), desc(applicationFills.createdAt)).limit(1)
  return row ?? null
}

/** Starts the fill the owner reviewed, if nothing else for the job is in progress; other prepared fills for it go stale. */
export async function startFill(scope: TenantScope, fillId: string, packetHash: string, now = new Date()): Promise<Result<Fill>> {
  const [fill] = await scope.db.select().from(applicationFills).where(byId(scope, fillId))
  if (!fill) return err(domainError('not_found', 'That fill was not found.'))
  if (fill.status !== 'prepared') return err(domainError('conflict', 'This fill was already started or has ended.'))
  if (fill.packetHash !== packetHash) return err(domainError('conflict', 'What you reviewed has changed. Review the application again.'))
  if (now.getTime() - fill.createdAt.getTime() > PREPARED_TTL_MS) return err(domainError('invalid_input', 'This review expired. Review the application again.'))
  await expireFills(scope, now)
  const [busy] = await scope.db.select({ id: applicationFills.id }).from(applicationFills).where(and(
    eq(applicationFills.userId, scope.userId), eq(applicationFills.jobId, fill.jobId),
    holdsSlot(),
  ))
  if (busy) return inProgress()
  try {
    // A savepoint: a concurrent start that wins the unique index fails this one alone.
    const started = await scope.db.transaction(async (savepoint) => {
      const [row] = await savepoint.update(applicationFills).set({ status: 'queued', updatedAt: now })
        .where(and(byId(scope, fillId), eq(applicationFills.status, 'prepared'))).returning()
      return row
    })
    if (!started) return err(domainError('conflict', 'This fill was already started or has ended.'))
    await scope.db.update(applicationFills).set({ status: 'stale', updatedAt: now }).where(and(
      eq(applicationFills.userId, scope.userId), eq(applicationFills.jobId, fill.jobId), eq(applicationFills.status, 'prepared'),
    ))
    return ok(started)
  } catch (error) {
    if (isUniqueViolation(error)) return inProgress()
    throw error
  }
}

const inProgress = () => err(domainError('conflict', 'Another fill for this job is in progress, or waits for you to say whether it was submitted.'))

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ('code' in e && e.code === '23505') return true
  }
  return false
}

/** Cancels a fill whose browser has not opened. Once it has, closing its window ends it. */
export async function cancelFill(scope: TenantScope, fillId: string): Promise<Result<Fill>> {
  const [row] = await scope.db.update(applicationFills).set({ status: 'abandoned', updatedAt: sql`now()` })
    .where(and(byId(scope, fillId), inArray(applicationFills.status, ['prepared', 'queued']))).returning()
  return row ? ok(row) : err(domainError('conflict', 'The browser is already open, or the fill has ended: close the browser window to stop it.'))
}

/** The worker takes the fill and its lease before opening a browser; a redelivered job finds it taken and gets null. */
export async function claimFill(scope: TenantScope, fillId: string, worker: string, now = new Date()): Promise<Fill | null> {
  const [row] = await scope.db.update(applicationFills)
    .set({ status: 'launching', leaseOwner: worker, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), updatedAt: now })
    .where(and(byId(scope, fillId), eq(applicationFills.status, 'queued'))).returning()
  return row ?? null
}

/** Before the browser opens: what was reviewed changed, or cannot be checked, so the owner reviews again. */
export async function markStale(scope: TenantScope, fillId: string, worker: string, why: string | null = null): Promise<Result<Fill>> {
  const [row] = await scope.db.update(applicationFills).set({ status: 'stale', error: why, ...released })
    .where(held(scope, fillId, worker, ['launching'])).returning()
  return row ? ok(row) : notHeld()
}

/** The browser is open: from here on, a submission can only be ruled out by the network. */
export async function markFilling(scope: TenantScope, fillId: string, worker: string): Promise<Result<Fill>> {
  const [row] = await scope.db.update(applicationFills).set({ status: 'filling', updatedAt: sql`now()` })
    .where(held(scope, fillId, worker, ['launching'])).returning()
  return row ? ok(row) : notHeld()
}

/** Renews the worker's lease; false once it is lost, and the worker closes the browser at once. */
export async function renewLease(scope: TenantScope, fillId: string, worker: string, now = new Date()): Promise<boolean> {
  const rows = await scope.db.update(applicationFills).set({ leaseExpiresAt: new Date(now.getTime() + LEASE_MS), updatedAt: now })
    .where(and(held(scope, fillId, worker, OPEN), gt(applicationFills.leaseExpiresAt, now))).returning({ id: applicationFills.id })
  return rows.length > 0
}

/** The form is filled as far as possible; it waits for the owner. */
export async function recordReport(scope: TenantScope, fillId: string, worker: string, report: FillReport): Promise<Result<Fill>> {
  const [row] = await scope.db.update(applicationFills).set({ status: 'waiting', fillReport: report, updatedAt: sql`now()` })
    .where(held(scope, fillId, worker, ['filling'])).returning()
  return row ? ok(row) : notHeld()
}

/**
 * The first of two writes: the captured submission and what Greenhouse said. Confirmed:
 * submitted, awaiting its application. Rejected: failed, the slot free again. Unknown:
 * uncertain, for the owner to settle.
 */
export async function recordSubmission(scope: TenantScope, fillId: string, worker: string, captured: {
  readonly submission: CapturedSubmission; readonly outcome: Exclude<FillOutcome, 'user_reported'>; readonly evidence: OutcomeEvidence
}): Promise<Result<Fill>> {
  const status: FillStatus = captured.outcome === 'confirmed' ? 'submitted' : captured.outcome === 'rejected' ? 'failed' : 'uncertain'
  const [row] = await scope.db.update(applicationFills)
    .set({ status, submission: captured.submission, outcome: captured.outcome, outcomeEvidence: captured.evidence, ...released })
    .where(held(scope, fillId, worker, ['filling', 'waiting'])).returning()
  return row ? ok(row) : notHeld()
}

/**
 * Any other end of an attempt (an error, the window closed, a timeout). Abandoned or failed
 * only when the network ruled a submission out; otherwise uncertain.
 */
export async function endAttempt(scope: TenantScope, fillId: string, worker: string, ending: {
  readonly ruledOut: boolean; readonly ending: 'error' | 'closed' | 'timeout'; readonly detail: string | null
}): Promise<Result<Fill>> {
  const status: FillStatus = !ending.ruledOut ? 'uncertain' : ending.ending === 'error' ? 'failed' : 'abandoned'
  const [row] = await scope.db.update(applicationFills).set({ status, error: ending.detail, ...released })
    .where(held(scope, fillId, worker, OPEN)).returning()
  return row ? ok(row) : notHeld()
}

/**
 * A lease that ran out leaves its fill uncertain: the browser may have been open. A fill
 * queued too long without a worker is abandoned: no browser ever opened for it. So is a
 * review left unstarted past PREPARED_TTL_MS, so its page offers "Review again".
 */
export async function expireFills(scope: TenantScope, now = new Date()): Promise<void> {
  await scope.db.update(applicationFills)
    .set({ status: 'uncertain', error: 'The worker stopped holding this fill while its browser may have been open.', ...released, updatedAt: now })
    .where(and(eq(applicationFills.userId, scope.userId), inArray(applicationFills.status, OPEN), lt(applicationFills.leaseExpiresAt, now)))
  await scope.db.update(applicationFills).set({ status: 'abandoned', error: 'No worker took this fill.', updatedAt: now })
    .where(and(eq(applicationFills.userId, scope.userId), eq(applicationFills.status, 'queued'), lt(applicationFills.updatedAt, new Date(now.getTime() - QUEUED_TTL_MS))))
  await scope.db.update(applicationFills).set({ status: 'abandoned', error: 'The review expired before it was started.', updatedAt: now })
    .where(and(eq(applicationFills.userId, scope.userId), eq(applicationFills.status, 'prepared'), lt(applicationFills.createdAt, new Date(now.getTime() - PREPARED_TTL_MS))))
}

/**
 * The owner's word on a fill: "I submitted it" (while waiting, or uncertain) keeps any
 * captured request and records the outcome as theirs; "I didn't" (uncertain only, since an
 * open browser could still submit) frees the job's slot.
 */
export async function settleFill(scope: TenantScope, fillId: string, said: 'submitted' | 'not_submitted', now = new Date()): Promise<Result<Fill>> {
  const [row] = said === 'submitted'
    ? await scope.db.update(applicationFills)
      .set({ status: 'submitted', outcome: 'user_reported', outcomeEvidence: { kind: 'owner_report', at: now.toISOString() }, ...released })
      .where(and(byId(scope, fillId), inArray(applicationFills.status, ['waiting', 'uncertain']))).returning()
    : await scope.db.update(applicationFills).set({ status: 'abandoned', ...released })
      .where(and(byId(scope, fillId), eq(applicationFills.status, 'uncertain'))).returning()
  return row ? ok(row) : err(domainError('conflict', 'This fill cannot be settled that way now.'))
}

/** Finishes recording every submitted fill whose application is not recorded yet; run when the owner opens the app. */
export async function finishPending(scope: TenantScope, appliedOn: string): Promise<{ readonly recorded: number; readonly conflicts: number }> {
  const pending = await scope.db.select({ id: applicationFills.id }).from(applicationFills).where(and(
    eq(applicationFills.userId, scope.userId), eq(applicationFills.status, 'submitted'), isNull(applicationFills.applicationId),
  ))
  let recorded = 0
  let conflicts = 0
  for (const { id } of pending) {
    const result = await finishRecording(scope, id, appliedOn)
    if (result.ok) recorded++
    else conflicts++
  }
  return { recorded, conflicts }
}

/**
 * The second write: the application, assisted, against the posting version reviewed, linked
 * to its fill in the same transaction. Finishing again returns the same application. An
 * application for the job recorded another way is a conflict, for the owner to look at.
 */
export async function finishRecording(scope: TenantScope, fillId: string, appliedOn: string): Promise<Result<Application>> {
  const [fill] = await scope.db.select().from(applicationFills).where(byId(scope, fillId))
  if (!fill) return err(domainError('not_found', 'That fill was not found.'))
  if (fill.status !== 'submitted') return err(domainError('conflict', 'Only a submitted fill is recorded as an application.'))
  if (fill.applicationId !== null) {
    const recorded = await getApplication(scope, fill.applicationId)
    return recorded.ok ? ok(recorded.value.application) : recorded
  }
  const created = await createApplication(scope, {
    jobId: fill.jobId, appliedOn, resumeId: fill.packet.resume?.id ?? null, salaryAsked: null, contact: null, notes: null, sourceUrl: null,
  }, { mode: 'assisted', rawJobId: fill.rawJobId })
  if (!created.ok) {
    return created.error.code === 'conflict'
      ? err(domainError('conflict', 'An application for this job was already recorded another way. Check it on the applications page.'))
      : created
  }
  await scope.db.update(applicationFills).set({ applicationId: created.value.id, updatedAt: sql`now()` })
    .where(and(byId(scope, fillId), isNull(applicationFills.applicationId)))
  return ok(created.value)
}
