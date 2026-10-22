import { and, asc, count, eq, getTableColumns, inArray, lte, min, or, isNull, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { domainError, err, ok, type Result } from '@/lib/result'
import { AdapterConfigSchema, type Fetcher, type FetchResult } from './adapter.js'
import { contentHash } from './content-hash.js'
import { POLL_INTERVAL_MS } from './queues.js'
import { getAdapter } from './registry.js'
import { jobSources, rawJobs } from './schema.js'
import type {
  JobSource, JobSourceSummary, NewSource, NormalizationReport, NormalizedPosting, PagePosting, PollOutcome, SourcePollPayload,
} from './types.js'

type SourceRow = typeof jobSources.$inferSelect

// jsonb read back from the database is parsed at this boundary, not trusted by its column type.
function toJobSource(row: SourceRow): JobSource {
  const config = AdapterConfigSchema.safeParse(row.config)
  return { ...row, config: config.success ? config.data : null }
}

export async function addSource(db: Db, input: NewSource, fetcher: Fetcher): Promise<Result<JobSource>> {
  const health = await getAdapter(input.adapterKey).health({ name: input.name, config: { token: input.token } }, fetcher)
  if (!health.ok) return err(domainError('invalid_input', health.message ?? 'Source is unavailable.'))
  const [existing] = await db.select({ id: jobSources.id }).from(jobSources).where(and(
    eq(jobSources.adapterKey, input.adapterKey), sql`${jobSources.config}->>'token' = ${input.token}`,
  )).limit(1)
  if (existing) return err(domainError('conflict', 'This adapter and token are already registered.'))
  const [inserted] = await db.insert(jobSources).values({
    adapterKey: input.adapterKey, name: input.name, config: { token: input.token },
    healthStatus: 'ok', healthCheckedAt: health.checkedAt,
  }).onConflictDoNothing().returning()
  // The precheck avoids a transaction-aborting violation; this also handles concurrent registration.
  return inserted ? ok(toJobSource(inserted)) : err(domainError('conflict', 'This adapter and token are already registered.'))
}

export async function listSources(db: Db): Promise<JobSourceSummary[]> {
  const rows = await db.select({ ...getTableColumns(jobSources), rawJobCount: count(rawJobs.id) })
    .from(jobSources).leftJoin(rawJobs, eq(rawJobs.sourceId, jobSources.id))
    .groupBy(jobSources.id).orderBy(asc(jobSources.name), asc(jobSources.id))
  return rows.map(({ rawJobCount, ...row }) => ({ ...toJobSource(row), rawJobCount }))
}

export async function setSourceEnabled(db: Db, sourceId: string, enabled: boolean): Promise<Result<void>> {
  const changed = await db.update(jobSources).set({ enabled }).where(eq(jobSources.id, sourceId)).returning({ id: jobSources.id })
  return changed.length ? ok(undefined) : err(domainError('not_found', 'Source not found.'))
}

async function markFailing(db: Db, sourceId: string, message: string): Promise<void> {
  await db.update(jobSources).set({ healthStatus: 'failing', healthMessage: message, healthCheckedAt: sql`now()` }).where(eq(jobSources.id, sourceId))
}

/** Stores the page's new versions and returns the raw version now representing each posting. */
async function recordPage(db: Db, sourceId: string, page: FetchResult, volatileKeys: readonly string[]): Promise<PagePosting[]> {
  const hashed = page.raw.map((raw) => ({ raw, contentHash: contentHash(raw.payload, volatileKeys) }))
  return db.transaction(async (tx) => {
    const current = new Map<string, string>()
    // A board can exceed Postgres's parameter limit in one statement; batches stay in one transaction.
    for (let offset = 0; offset < hashed.length; offset += 500) {
      const batch = hashed.slice(offset, offset + 500)
      await tx.insert(rawJobs).values(batch.map(({ raw, contentHash: hash }) => ({
        sourceId, externalId: raw.externalId, payload: raw.payload, contentHash: hash, fetchedAt: raw.fetchedAt,
      }))).onConflictDoNothing({ target: [rawJobs.sourceId, rawJobs.externalId, rawJobs.contentHash] })
      // Unchanged postings hit the unique key above, so their existing version is looked up.
      const stored = await tx.select({ id: rawJobs.id, externalId: rawJobs.externalId, contentHash: rawJobs.contentHash })
        .from(rawJobs).where(and(eq(rawJobs.sourceId, sourceId), inArray(rawJobs.contentHash, batch.map((b) => b.contentHash))))
      for (const row of stored) current.set(`${row.externalId}\n${row.contentHash}`, row.id)
    }
    await tx.update(jobSources).set({
      healthStatus: 'ok', healthMessage: null, healthCheckedAt: sql`now()`, cursor: page.next,
      ...(page.next === null ? { lastPolledAt: sql`now()` } : {}),
    }).where(eq(jobSources.id, sourceId))
    return hashed.map(({ raw, contentHash: hash }) => {
      const rawJobId = current.get(`${raw.externalId}\n${hash}`)
      if (rawJobId === undefined) throw new Error(`raw job ${raw.externalId} was neither inserted nor found`)
      return { externalId: raw.externalId, rawJobId }
    })
  })
}

export async function pollSourcePage(
  db: Db,
  payload: SourcePollPayload,
  deps: { readonly fetcher: Fetcher; readonly enqueueNextPage: (p: SourcePollPayload) => Promise<Result<void>> },
): Promise<Result<PollOutcome>> {
  const [source] = await db.select().from(jobSources).where(eq(jobSources.id, payload.sourceId))
  if (!source) return err(domainError('not_found', 'Source not found.'))
  if (!source.enabled) return ok({ kind: 'disabled' })
  const config = AdapterConfigSchema.safeParse(source.config)
  if (!config.success) {
    await markFailing(db, source.id, 'Invalid source configuration.')
    return err(domainError('invalid_input', 'Invalid source configuration.'))
  }
  const adapter = getAdapter(source.adapterKey)
  const page = await adapter.fetchPage({ name: source.name, config: config.data }, payload.cursor, deps.fetcher)
  if (!page.ok) {
    await markFailing(db, source.id, page.error.message)
    return page
  }
  const postings = await recordPage(db, source.id, page.value, adapter.volatileKeys)
  if (page.value.next !== null) {
    const enqueued = await deps.enqueueNextPage({ ...payload, cursor: page.value.next })
    if (!enqueued.ok) return enqueued
  }
  return ok({
    kind: 'page', sourceId: source.id, postings, isFinalPage: page.value.next === null,
    fetchedAt: page.value.raw[0]?.fetchedAt ?? new Date(),
  })
}

export async function dispatchSourcePolls(
  db: Db,
  now: Date,
  enqueue: (p: SourcePollPayload) => Promise<Result<void>>,
): Promise<Result<{ readonly enqueued: number }>> {
  const due = await db.select({ id: jobSources.id }).from(jobSources).where(and(
    eq(jobSources.enabled, true), or(isNull(jobSources.lastPolledAt), lte(jobSources.lastPolledAt, new Date(now.getTime() - POLL_INTERVAL_MS))),
  )).orderBy(asc(jobSources.id))
  const windowStart = Math.floor(now.getTime() / POLL_INTERVAL_MS) * POLL_INTERVAL_MS
  let enqueued = 0
  for (const source of due) {
    const result = await enqueue({ sourceId: source.id, pollId: `w${windowStart}`, cursor: null, startedAt: now })
    if (!result.ok) return result
    enqueued++
  }
  return ok({ enqueued })
}

export async function checkNormalization(db: Db): Promise<NormalizationReport> {
  const rows = await db.select({ raw: rawJobs, source: jobSources }).from(rawJobs)
    .innerJoin(jobSources, eq(jobSources.id, rawJobs.sourceId)).orderBy(asc(rawJobs.sourceId), asc(rawJobs.externalId))
  const failures: { sourceId: string; externalId: string; message: string }[] = []
  for (const { raw, source } of rows) {
    const config = AdapterConfigSchema.safeParse(source.config)
    const result = config.success
      ? getAdapter(source.adapterKey).normalize(raw, { name: source.name, config: config.data })
      : err(domainError('invalid_input', 'Invalid source configuration.'))
    if (!result.ok) failures.push({ sourceId: source.id, externalId: raw.externalId, message: result.error.message })
  }
  return { checked: rows.length, failures }
}

/** The newest version of every captured posting: the input to a full re-normalization. */
export async function listLatestRawJobIds(db: Db): Promise<string[]> {
  const rows = await db.selectDistinctOn([rawJobs.sourceId, rawJobs.externalId], { id: rawJobs.id })
    .from(rawJobs).orderBy(rawJobs.sourceId, rawJobs.externalId, sql`${rawJobs.fetchedAt} desc`)
  return rows.map((row) => row.id)
}

/** One stored version run through its source's adapter. Read-only; replaying it is always safe. */
export async function readNormalizedPosting(db: Db, rawJobId: string): Promise<Result<NormalizedPosting>> {
  const [row] = await db.select({ raw: rawJobs, source: jobSources }).from(rawJobs)
    .innerJoin(jobSources, eq(jobSources.id, rawJobs.sourceId)).where(eq(rawJobs.id, rawJobId))
  if (!row) return err(domainError('not_found', `raw job ${rawJobId} not found`))
  const config = AdapterConfigSchema.safeParse(row.source.config)
  if (!config.success) return err(domainError('invalid_input', `source ${row.source.id} has an invalid configuration`))
  const job = getAdapter(row.source.adapterKey).normalize(row.raw, { name: row.source.name, config: config.data })
  if (!job.ok) return job
  const [first] = await db.select({ at: min(rawJobs.fetchedAt) }).from(rawJobs)
    .where(and(eq(rawJobs.sourceId, row.raw.sourceId), eq(rawJobs.externalId, row.raw.externalId)))
  return ok({
    rawJobId: row.raw.id, sourceId: row.raw.sourceId, externalId: row.raw.externalId,
    fetchedAt: row.raw.fetchedAt, firstFetchedAt: first?.at ?? row.raw.fetchedAt, job: job.value,
  })
}
