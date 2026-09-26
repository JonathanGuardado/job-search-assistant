import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import type { TenantScope } from '@/lib/db/tenancy'
import { domainError, err, ok, type Result } from '@/lib/result'
import { jobs, jobUserStates } from './schema.js'
import type {
  Job,
  JobSeenPayload,
  JobUserState,
  JobUserStateValue,
  NewJob,
  Salary,
} from './types.js'

type JobRow = typeof jobs.$inferSelect
type JobUserStateRow = typeof jobUserStates.$inferSelect

function salaryColumns(salary: Salary) {
  return salary.source === 'unknown'
    ? { salarySource: 'unknown' as const, salaryMinMinor: null, salaryMaxMinor: null, salaryCurrency: null }
    : {
        salarySource: 'posted' as const,
        salaryMinMinor: salary.minMinor,
        salaryMaxMinor: salary.maxMinor,
        salaryCurrency: salary.currency,
      }
}

function toSalary(row: JobRow): Salary {
  if (row.salarySource === 'unknown') return { source: 'unknown' }
  if (row.salaryCurrency === null) {
    throw new Error(`job ${row.id}: posted salary without currency; jobs_salary_check is missing`)
  }
  return {
    source: 'posted',
    minMinor: row.salaryMinMinor,
    maxMinor: row.salaryMaxMinor,
    currency: row.salaryCurrency,
  }
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    canonicalJobId: row.canonicalJobId,
    companyName: row.companyName,
    companyNormalized: row.companyNormalized,
    title: row.title,
    titleNormalized: row.titleNormalized,
    description: row.description,
    locationPolicy: row.locationPolicy,
    locationText: row.locationText,
    employmentType: row.employmentType,
    salary: toSalary(row),
    applyUrl: row.applyUrl,
    fingerprint: row.fingerprint,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    closedAt: row.closedAt,
  }
}

function toJobUserState(row: JobUserStateRow): JobUserState {
  return { userId: row.userId, jobId: row.jobId, state: row.state, updatedAt: row.updatedAt }
}

/** `input` must already be parsed with NewJobSchema at the boundary it arrived through. */
export async function insertJob(db: Db, input: NewJob): Promise<Job> {
  const { salary, seenAt, ...fields } = input
  const [row] = await db
    .insert(jobs)
    .values({ ...fields, ...salaryColumns(salary), firstSeenAt: seenAt, lastSeenAt: seenAt })
    .returning()
  if (!row) throw new Error('insert ... returning produced no row')
  return toJob(row)
}

export async function getJob(db: Db, id: string): Promise<Result<Job>> {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id))
  return row ? ok(toJob(row)) : err(domainError('not_found', `job ${id} not found`))
}

/**
 * Idempotent and order-independent: replaying or reordering observations never
 * moves last_seen_at backwards, so a retried queue job cannot corrupt it.
 */
export async function markJobSeen(db: Db, { jobId, seenAt }: JobSeenPayload): Promise<Result<void>> {
  const updated = await db
    .update(jobs)
    .set({ lastSeenAt: sql`greatest(${jobs.lastSeenAt}, ${seenAt.toISOString()}::timestamptz)` })
    .where(eq(jobs.id, jobId))
    .returning({ id: jobs.id })
  return updated.length > 0 ? ok(undefined) : err(domainError('not_found', `job ${jobId} not found`))
}

export async function setJobUserState(
  scope: TenantScope,
  input: { readonly jobId: string; readonly state: JobUserStateValue },
): Promise<Result<JobUserState>> {
  // Checked up front: a foreign-key violation would abort the caller's transaction.
  const [job] = await scope.db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, input.jobId))
  if (!job) return err(domainError('not_found', `job ${input.jobId} not found`))

  const [row] = await scope.db
    .insert(jobUserStates)
    .values({ userId: scope.userId, jobId: input.jobId, state: input.state })
    .onConflictDoUpdate({
      target: [jobUserStates.userId, jobUserStates.jobId],
      set: { state: input.state, updatedAt: sql`now()` },
    })
    .returning()
  if (!row) throw new Error('upsert ... returning produced no row')
  return ok(toJobUserState(row))
}

export async function getJobUserState(
  scope: TenantScope,
  jobId: string,
): Promise<Result<JobUserState>> {
  // The user filter is redundant with RLS; it is kept so the query reads correctly on its own.
  const [row] = await scope.db
    .select()
    .from(jobUserStates)
    .where(and(eq(jobUserStates.userId, scope.userId), eq(jobUserStates.jobId, jobId)))
  return row
    ? ok(toJobUserState(row))
    : err(domainError('not_found', `no state for job ${jobId}`))
}
