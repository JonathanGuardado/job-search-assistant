import { and, asc, desc, eq, isNotNull, max, min, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import type { TenantScope } from '@/lib/db/tenancy'
import { domainError, err, ok, type Result } from '@/lib/result'
import { readNormalizedPosting, type NormalizedPosting } from '@/modules/job-sources'
import { getJob, getJobRawVersion, setJobUserState } from '@/modules/jobs'
import { getResume } from '@/modules/resumes'
import { applicationEvents, applications } from './schema.js'
import type { Application, ApplicationEdit, ApplicationEvent, NewApplication, StatusChange } from './types.js'

type ApplicationRow = typeof applications.$inferSelect
export type ApplicationListItem = Application & { lastActivityOn: string }

function toApplication(row: ApplicationRow): Application {
  const { salaryAskedMinor, salaryAskedCurrency, ...application } = row
  return {
    ...application,
    salaryAsked: salaryAskedMinor === null || salaryAskedCurrency === null
      ? null : { amountMinor: salaryAskedMinor, currency: salaryAskedCurrency },
  }
}

const applicationWhere = (scope: TenantScope, applicationId: string) =>
  and(eq(applications.userId, scope.userId), eq(applications.id, applicationId))

const missingApplication = () => err(domainError('not_found', 'That application was not found.'))
const duplicateApplication = () => err(domainError('conflict', 'You already logged an application for this job.'))

async function checkDetails(scope: TenantScope, input: Pick<NewApplication, 'appliedOn' | 'resumeId'>): Promise<Result<void>> {
  if (input.appliedOn > new Date().toISOString().slice(0, 10)) {
    return err(domainError('invalid_input', 'The application date cannot be in the future.'))
  }
  if (input.resumeId !== null && !(await getResume(scope, input.resumeId)).ok) {
    return err(domainError('not_found', 'That resume version was not found.'))
  }
  return ok(undefined)
}

export async function createApplication(scope: TenantScope, input: NewApplication): Promise<Result<Application>> {
  const job = await getJob(scope.db, input.jobId)
  if (!job.ok) return job
  const checked = await checkDetails(scope, input)
  if (!checked.ok) return checked
  if (await getApplicationForJob(scope, input.jobId)) return duplicateApplication()
  const rawVersion = await getJobRawVersion(scope.db, input.jobId)
  if (!rawVersion.ok) return rawVersion
  const [row] = await scope.db.insert(applications).values({
    userId: scope.userId, jobId: input.jobId, rawJobId: rawVersion.value, status: 'applied',
    appliedOn: input.appliedOn, resumeId: input.resumeId,
    salaryAskedMinor: input.salaryAsked?.amountMinor ?? null,
    salaryAskedCurrency: input.salaryAsked?.currency ?? null,
    sourceUrl: input.sourceUrl ?? job.value.applyUrl, contact: input.contact, notes: input.notes,
  }).onConflictDoNothing({ target: [applications.userId, applications.jobId] }).returning()
  // A concurrent submission can win after the initial existence check.
  if (!row) return duplicateApplication()
  await scope.db.insert(applicationEvents).values({
    userId: scope.userId, applicationId: row.id, fromStatus: null, toStatus: 'applied',
    occurredOn: input.appliedOn, note: null,
  })
  const state = await setJobUserState(scope, { jobId: input.jobId, state: 'applied' })
  // The application's foreign key keeps this job alive. Abort the transaction if that invariant breaks.
  if (!state.ok) throw new Error(state.error.message)
  return ok(toApplication(row))
}

export async function changeStatus(scope: TenantScope, input: StatusChange): Promise<Result<Application>> {
  // Serialize moves so each history entry starts from the last committed stage.
  const [current] = await scope.db.select().from(applications)
    .where(applicationWhere(scope, input.applicationId)).for('update')
  if (!current) return missingApplication()
  if (input.to === current.status) return err(domainError('invalid_input', `It is already ${input.to}.`))
  if (input.occurredOn > new Date().toISOString().slice(0, 10)) {
    return err(domainError('invalid_input', 'A change cannot happen in the future.'))
  }
  if (input.occurredOn < current.appliedOn) {
    return err(domainError('invalid_input', 'A change cannot happen before the application was sent.'))
  }
  const [row] = await scope.db.update(applications).set({ status: input.to, updatedAt: sql`now()` })
    .where(applicationWhere(scope, input.applicationId)).returning()
  if (!row) throw new Error('locked application disappeared during stage change')
  await scope.db.insert(applicationEvents).values({
    userId: scope.userId, applicationId: row.id, fromStatus: current.status,
    toStatus: input.to, occurredOn: input.occurredOn, note: input.note,
  })
  return ok(toApplication(row))
}

export async function updateApplication(scope: TenantScope, applicationId: string, edit: ApplicationEdit): Promise<Result<Application>> {
  const [current] = await scope.db.select().from(applications).where(applicationWhere(scope, applicationId))
  if (!current) return missingApplication()
  const checked = await checkDetails(scope, edit)
  if (!checked.ok) return checked
  // The history must still read in order: nothing can have happened before the application was sent.
  const [firstMove] = await scope.db.select({ on: min(applicationEvents.occurredOn) }).from(applicationEvents)
    .where(and(eq(applicationEvents.userId, scope.userId), eq(applicationEvents.applicationId, applicationId), isNotNull(applicationEvents.fromStatus)))
  if (firstMove?.on && edit.appliedOn > firstMove.on) {
    return err(domainError('invalid_input', `The application date cannot be after a stage change already recorded (${firstMove.on}).`))
  }
  const [row] = await scope.db.update(applications).set({
    appliedOn: edit.appliedOn, resumeId: edit.resumeId,
    salaryAskedMinor: edit.salaryAsked?.amountMinor ?? null,
    salaryAskedCurrency: edit.salaryAsked?.currency ?? null,
    contact: edit.contact, notes: edit.notes, outcomeReason: edit.outcomeReason, updatedAt: sql`now()`,
  }).where(applicationWhere(scope, applicationId)).returning()
  return row ? ok(toApplication(row)) : missingApplication()
}

export async function listApplications(scope: TenantScope): Promise<ApplicationListItem[]> {
  const lastActivity = max(applicationEvents.occurredOn)
  const rows = await scope.db.select({ application: applications, lastActivityOn: lastActivity })
    .from(applications).leftJoin(applicationEvents, and(
      eq(applicationEvents.applicationId, applications.id), eq(applicationEvents.userId, scope.userId),
    )).where(eq(applications.userId, scope.userId)).groupBy(applications.id)
    .orderBy(desc(lastActivity), desc(applications.createdAt))
  return rows.map(({ application, lastActivityOn }) => ({
    ...toApplication(application), lastActivityOn: lastActivityOn ?? application.appliedOn,
  }))
}

export async function getApplication(scope: TenantScope, applicationId: string): Promise<Result<{ application: Application; events: ApplicationEvent[] }>> {
  const [row] = await scope.db.select().from(applications).where(applicationWhere(scope, applicationId))
  if (!row) return missingApplication()
  const events = await scope.db.select({
    id: applicationEvents.id, applicationId: applicationEvents.applicationId,
    fromStatus: applicationEvents.fromStatus, toStatus: applicationEvents.toStatus,
    note: applicationEvents.note, occurredOn: applicationEvents.occurredOn, recordedAt: applicationEvents.recordedAt,
  }).from(applicationEvents).where(and(
    eq(applicationEvents.userId, scope.userId), eq(applicationEvents.applicationId, applicationId),
  )).orderBy(asc(applicationEvents.occurredOn), asc(applicationEvents.recordedAt))
  return ok({ application: toApplication(row), events })
}

export async function getApplicationForJob(scope: TenantScope, jobId: string): Promise<Application | null> {
  const [row] = await scope.db.select().from(applications).where(and(
    eq(applications.userId, scope.userId), eq(applications.jobId, jobId),
  ))
  return row ? toApplication(row) : null
}

export function postingAsApplied(db: Db, application: Pick<Application, 'rawJobId'>): Promise<Result<NormalizedPosting>> {
  return readNormalizedPosting(db, application.rawJobId)
}
