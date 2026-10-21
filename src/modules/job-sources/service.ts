import { and, asc, count, eq, getTableColumns, lte, or, isNull, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { domainError, err, ok, type Result } from '@/lib/result'
import { AdapterConfigSchema, type Fetcher, type FetchResult } from './adapter.js'
import { contentHash } from './content-hash.js'
import { POLL_INTERVAL_MS } from './queues.js'
import { getAdapter } from './registry.js'
import { jobSources, rawJobs } from './schema.js'
import type { JobSource, JobSourceSummary, NewSource, NormalizationReport, SourcePollPayload } from './types.js'

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

async function recordPage(db: Db, sourceId: string, page: FetchResult): Promise<void> {
  await db.transaction(async (tx) => {
    // A board can exceed Postgres's parameter limit in one insert; batches stay in one transaction.
    for (let offset = 0; offset < page.raw.length; offset += 500) {
      await tx.insert(rawJobs).values(page.raw.slice(offset, offset + 500).map((raw) => ({
        sourceId, externalId: raw.externalId, payload: raw.payload,
        contentHash: contentHash(raw.payload), fetchedAt: raw.fetchedAt,
      }))).onConflictDoNothing({ target: [rawJobs.sourceId, rawJobs.externalId, rawJobs.contentHash] })
    }
    await tx.update(jobSources).set({
      healthStatus: 'ok', healthMessage: null, healthCheckedAt: sql`now()`, cursor: page.next,
      ...(page.next === null ? { lastPolledAt: sql`now()` } : {}),
    }).where(eq(jobSources.id, sourceId))
  })
}

export async function pollSourcePage(
  db: Db,
  payload: SourcePollPayload,
  deps: { readonly fetcher: Fetcher; readonly enqueueNextPage: (p: SourcePollPayload) => Promise<Result<void>> },
): Promise<Result<void>> {
  const [source] = await db.select().from(jobSources).where(eq(jobSources.id, payload.sourceId))
  if (!source) return err(domainError('not_found', 'Source not found.'))
  if (!source.enabled) return ok(undefined)
  const config = AdapterConfigSchema.safeParse(source.config)
  if (!config.success) {
    await markFailing(db, source.id, 'Invalid source configuration.')
    return err(domainError('invalid_input', 'Invalid source configuration.'))
  }
  const page = await getAdapter(source.adapterKey).fetchPage({ name: source.name, config: config.data }, payload.cursor, deps.fetcher)
  if (!page.ok) {
    await markFailing(db, source.id, page.error.message)
    return page
  }
  await recordPage(db, source.id, page.value)
  return page.value.next === null ? ok(undefined) : deps.enqueueNextPage({ ...payload, cursor: page.value.next })
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
    const result = await enqueue({ sourceId: source.id, pollId: `w${windowStart}`, cursor: null })
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
