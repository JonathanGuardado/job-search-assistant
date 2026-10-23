import { and, asc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import type { TenantScope } from '@/lib/db/tenancy'
import { domainError, err, ok, type Result } from '@/lib/result'
import { readNormalizedPosting, type PagePosting } from '@/modules/job-sources'
import { fingerprint, locationKey } from './fingerprint.js'
import { normalizeCompany } from './normalize-company.js'
import { normalizeTitle } from './normalize-title.js'
import { salaryFromText } from './salary-text.js'
import { jobs, jobUserStates } from './schema.js'
import type { Job, JobUserState, JobUserStateValue, Salary } from './types.js'

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
    sourceId: row.sourceId,
    externalId: row.externalId,
    canonicalJobId: row.canonicalJobId,
    companyName: row.companyName,
    companyNormalized: row.companyNormalized,
    title: row.title,
    titleNormalized: row.titleNormalized,
    seniority: row.seniority,
    description: row.description,
    locationPolicy: row.locationPolicy,
    locationText: row.locationText,
    locationCountry: row.locationCountry,
    employmentType: row.employmentType,
    salary: toSalary(row),
    salaryQuote: row.salaryQuote,
    applyUrl: row.applyUrl,
    postedAt: row.postedAt,
    fingerprint: row.fingerprint,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    closedAt: row.closedAt,
  }
}

function toJobUserState(row: JobUserStateRow): JobUserState {
  return { userId: row.userId, jobId: row.jobId, state: row.state, updatedAt: row.updatedAt }
}

/** Open canonical jobs: the ones a candidate is shown, and so the ones assessed. */
export async function listAssessableJobs(db: Db): Promise<{ readonly id: string; readonly fingerprint: string }[]> {
  return db.select({ id: jobs.id, fingerprint: jobs.fingerprint }).from(jobs)
    .where(and(isNull(jobs.closedAt), isNull(jobs.canonicalJobId))).orderBy(asc(jobs.firstSeenAt), asc(jobs.id))
}

export async function getJob(db: Db, id: string): Promise<Result<Job>> {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id))
  return row ? ok(toJob(row)) : err(domainError('not_found', `job ${id} not found`))
}

// ---------------------------------------------------------------------------
// Duplicate links (decision 0008). A cluster is the open jobs sharing a fingerprint;
// its canonical is the earliest seen (ties broken by id), and the rest point at it.

const isEarlier = (a: Pick<JobRow, 'firstSeenAt' | 'id'>, b: Pick<JobRow, 'firstSeenAt' | 'id'>) =>
  a.firstSeenAt < b.firstSeenAt || (a.firstSeenAt.getTime() === b.firstSeenAt.getTime() && a.id < b.id)

/** Joins an open, unlinked job to the cluster of open jobs sharing its fingerprint, if there is one. */
async function attach(db: Db, job: JobRow): Promise<void> {
  const [canonical] = await db.select().from(jobs).where(and(
    eq(jobs.fingerprint, job.fingerprint), isNull(jobs.closedAt), isNull(jobs.canonicalJobId), ne(jobs.id, job.id),
  )).orderBy(asc(jobs.firstSeenAt), asc(jobs.id)).limit(1)
  if (!canonical) return
  if (isEarlier(job, canonical)) {
    // The newcomer was seen first (a replay, or a second source), so it takes over the cluster.
    await db.update(jobs).set({ canonicalJobId: job.id })
      .where(or(eq(jobs.id, canonical.id), eq(jobs.canonicalJobId, canonical.id)))
  } else {
    await db.update(jobs).set({ canonicalJobId: canonical.id }).where(eq(jobs.id, job.id))
  }
}

/**
 * Recomputes a job's place after its fingerprint or open state changed. Its duplicates
 * are released and re-attached, so closing a canonical promotes the earliest open
 * duplicate instead of hiding the whole cluster behind a closed posting.
 */
async function relink(db: Db, jobId: string): Promise<void> {
  const released = await db.update(jobs).set({ canonicalJobId: null })
    .where(eq(jobs.canonicalJobId, jobId)).returning({ id: jobs.id })
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId))
  // A closed duplicate keeps its link as a record of where it was also posted.
  if (job && job.closedAt === null) {
    const [unlinked] = await db.update(jobs).set({ canonicalJobId: null }).where(eq(jobs.id, jobId)).returning()
    if (unlinked) await attach(db, unlinked)
  }
  if (released.length === 0) return
  const members = await db.select().from(jobs)
    .where(inArray(jobs.id, released.map((r) => r.id))).orderBy(asc(jobs.firstSeenAt), asc(jobs.id))
  for (const member of members) {
    // An earlier member may already have taken this one into its cluster.
    const [current] = await db.select().from(jobs).where(eq(jobs.id, member.id))
    if (current && current.closedAt === null && current.canonicalJobId === null) await attach(db, current)
  }
}

// ---------------------------------------------------------------------------
// Normalization: raw version → canonical job. Pure in the raw payload, so replaying
// every stored version (pnpm jobs:renormalize) rebuilds the same rows.

/**
 * Writes the job for one stored raw version. Idempotent and order-safe: replaying a
 * version rewrites the same row, and an older version arriving after a newer one
 * changes nothing. `invalid_input` means the posting itself cannot be normalized.
 */
export async function upsertJobFromRaw(db: Db, rawJobId: string): Promise<Result<Job>> {
  const posting = await readNormalizedPosting(db, rawJobId)
  if (!posting.ok) return posting
  const { job, sourceId, externalId, fetchedAt, firstFetchedAt } = posting.value
  const companyNormalized = normalizeCompany(job.companyName)
  const { titleNormalized, seniority } = normalizeTitle(job.title)
  // A structured salary wins; otherwise the range the posting states in its text, if any.
  const stated = job.salary.source === 'unknown' ? salaryFromText(job.description) : null
  const fields = {
    rawJobId, rawFetchedAt: fetchedAt,
    companyName: job.companyName, companyNormalized, title: job.title, titleNormalized, seniority,
    description: job.description, locationPolicy: job.locationPolicy, locationText: job.locationText,
    locationCountry: job.locationCountry, employmentType: job.employmentType,
    ...salaryColumns(stated?.salary ?? job.salary), salaryQuote: stated?.quote ?? null,
    applyUrl: job.applyUrl, postedAt: job.postedAt,
    fingerprint: fingerprint({
      companyNormalized, titleNormalized, seniority, locationPolicy: job.locationPolicy,
      locationKey: locationKey(job.locationText), description: job.description,
    }),
  }
  return db.transaction(async (tx) => {
    const [written] = await tx.insert(jobs)
      .values({ ...fields, sourceId, externalId, firstSeenAt: firstFetchedAt, lastSeenAt: fetchedAt })
      .onConflictDoUpdate({
        target: [jobs.sourceId, jobs.externalId],
        set: {
          ...fields,
          firstSeenAt: sql`least(${jobs.firstSeenAt}, excluded.first_seen_at)`,
          lastSeenAt: sql`greatest(${jobs.lastSeenAt}, excluded.last_seen_at)`,
        },
        setWhere: sql`${jobs.rawFetchedAt} <= excluded.raw_fetched_at`,
      })
      .returning()
    if (written) await relink(tx, written.id)
    // No row written means a newer version is already in place; report that one.
    const [current] = await tx.select().from(jobs).where(and(eq(jobs.sourceId, sourceId), eq(jobs.externalId, externalId)))
    if (!current) throw new Error(`job for ${sourceId}/${externalId} vanished inside its own transaction`)
    return ok(toJob(current))
  })
}

// ---------------------------------------------------------------------------
// Sightings: what a poll saw. A job is open while its source keeps listing it.

/**
 * Marks the page's postings seen (reopening any that had closed) and returns the raw
 * versions whose job is missing or out of date. Recomputed from the page on every
 * call, so a retried poll re-requests whatever normalization did not happen.
 */
export async function recordSightings(
  db: Db,
  input: { readonly sourceId: string; readonly postings: readonly PagePosting[]; readonly seenAt: Date },
): Promise<{ readonly rawJobIdsToNormalize: readonly string[] }> {
  if (input.postings.length === 0) return { rawJobIdsToNormalize: [] }
  const onPage = and(eq(jobs.sourceId, input.sourceId), inArray(jobs.externalId, input.postings.map((p) => p.externalId)))
  return db.transaction(async (tx) => {
    const known = await tx.select({ id: jobs.id, externalId: jobs.externalId, rawJobId: jobs.rawJobId, closedAt: jobs.closedAt })
      .from(jobs).where(onPage)
    await tx.update(jobs).set({
      lastSeenAt: sql`greatest(${jobs.lastSeenAt}, ${input.seenAt.toISOString()}::timestamptz)`,
      closedAt: null,
    }).where(onPage)
    for (const reopened of known.filter((job) => job.closedAt !== null)) await relink(tx, reopened.id)
    const normalizedFrom = new Map(known.map((job) => [job.externalId, job.rawJobId]))
    return { rawJobIdsToNormalize: input.postings.filter((p) => normalizedFrom.get(p.externalId) !== p.rawJobId).map((p) => p.rawJobId) }
  })
}

/**
 * Closes the source's open jobs that its latest complete poll did not list. If the poll
 * listed none of the source's jobs, nothing is closed: an empty or broken response must
 * not wipe out a board.
 */
export async function closeUnseenJobs(
  db: Db,
  input: { readonly sourceId: string; readonly pollStartedAt: Date },
): Promise<{ readonly closed: number; readonly skipped: boolean }> {
  return db.transaction(async (tx) => {
    const [seenThisPoll] = await tx.select({ id: jobs.id }).from(jobs)
      .where(and(eq(jobs.sourceId, input.sourceId), gte(jobs.lastSeenAt, input.pollStartedAt))).limit(1)
    if (!seenThisPoll) return { closed: 0, skipped: true }
    const closed = await tx.update(jobs).set({ closedAt: sql`now()` })
      .where(and(eq(jobs.sourceId, input.sourceId), isNull(jobs.closedAt), lt(jobs.lastSeenAt, input.pollStartedAt)))
      .returning({ id: jobs.id })
    for (const job of closed) await relink(tx, job.id)
    return { closed: closed.length, skipped: false }
  })
}

// ---------------------------------------------------------------------------
// Per-user state.

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
