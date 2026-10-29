import { and, asc, count, eq, getTableColumns, inArray, lte, min, or, isNull, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { domainError, err, ok, type Result } from '@/lib/result'
import { AdapterConfigSchema, type ApplicationForm, type ApplicationPages, type Fetcher, type FetchResult } from './adapter.js'
import { contentHash } from './content-hash.js'
import { POLL_INTERVAL_MS } from './queues.js'
import { getAdapter } from './registry.js'
import { applicationForms, jobSources, rawJobs } from './schema.js'
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

// ---------------------------------------------------------------------------
// Application forms (decision 0013)

export type PostingRef = { readonly sourceId: string; readonly externalId: string }
export type StoredApplicationForm = { readonly form: ApplicationForm; readonly fetchedAt: Date }

/**
 * Fetches a posting's application form and stores it, replacing any earlier copy.
 * `unsupported`: the source publishes no structured form. `not_found` from the source
 * usually means the posting closed.
 */
export async function refreshApplicationForm(
  db: Db,
  posting: PostingRef,
  fetcher: Fetcher,
): Promise<Result<{ readonly kind: 'stored'; readonly form: ApplicationForm } | { readonly kind: 'unsupported' }>> {
  const [source] = await db.select().from(jobSources).where(eq(jobSources.id, posting.sourceId))
  if (!source) return err(domainError('not_found', `source ${posting.sourceId} not found`))
  const adapter = getAdapter(source.adapterKey)
  if (!adapter.fetchApplicationForm) return ok({ kind: 'unsupported' })
  const config = AdapterConfigSchema.safeParse(source.config)
  if (!config.success) return err(domainError('invalid_input', `source ${source.id} has an invalid configuration`))
  const fetched = await adapter.fetchApplicationForm({ name: source.name, config: config.data }, posting.externalId, fetcher)
  if (!fetched.ok) return fetched
  const fields = { payload: fetched.value.payload, form: fetched.value.form, fetchedAt: new Date() }
  await db.insert(applicationForms).values({ ...posting, ...fields })
    .onConflictDoUpdate({ target: [applicationForms.sourceId, applicationForms.externalId], set: fields })
  return ok({ kind: 'stored', form: fetched.value.form })
}

/**
 * Reads every stored form again from its kept payload, never fetching, after the parser
 * learns to read more of it (decision 0016: data-protection consent). A form that can no
 * longer be read is removed, so readiness treats it as not fetched rather than trusting an
 * older reading; the form-fetch queue tries it again.
 */
export async function rereadApplicationForms(db: Db): Promise<{ readonly reread: number; readonly removed: PostingRef[] }> {
  const rows = await db.select({ id: applicationForms.id, sourceId: applicationForms.sourceId, externalId: applicationForms.externalId, payload: applicationForms.payload, adapterKey: jobSources.adapterKey })
    .from(applicationForms).innerJoin(jobSources, eq(jobSources.id, applicationForms.sourceId))
  const removed: PostingRef[] = []
  let reread = 0
  for (const row of rows) {
    const read = getAdapter(row.adapterKey).readApplicationForm?.(row.payload)
    if (read?.ok) {
      await db.update(applicationForms).set({ form: read.value }).where(eq(applicationForms.id, row.id))
      reread++
    } else {
      await db.delete(applicationForms).where(eq(applicationForms.id, row.id))
      removed.push({ sourceId: row.sourceId, externalId: row.externalId })
    }
  }
  return { reread, removed }
}

/** The stored form of each posting asked for that has one, keyed "sourceId:externalId". One query, for list views. */
export async function getApplicationForms(db: Db, postings: readonly PostingRef[]): Promise<Map<string, StoredApplicationForm>> {
  const found = new Map<string, StoredApplicationForm>()
  if (postings.length === 0) return found
  const rows = await db.select({ sourceId: applicationForms.sourceId, externalId: applicationForms.externalId, form: applicationForms.form, fetchedAt: applicationForms.fetchedAt })
    .from(applicationForms)
    .where(or(...postings.map((p) => and(eq(applicationForms.sourceId, p.sourceId), eq(applicationForms.externalId, p.externalId)))))
  for (const row of rows) found.set(postingKey(row), { form: row.form, fetchedAt: row.fetchedAt })
  return found
}

/** Where a posting's form is filled and its application sent; only sources that publish forms have them. */
export async function applicationPages(db: Db, posting: PostingRef): Promise<Result<ApplicationPages>> {
  const [source] = await db.select().from(jobSources).where(eq(jobSources.id, posting.sourceId))
  if (!source) return err(domainError('not_found', `source ${posting.sourceId} not found`))
  const config = AdapterConfigSchema.safeParse(source.config)
  if (!config.success) return err(domainError('invalid_input', `source ${source.id} has an invalid configuration`))
  const pages = getAdapter(source.adapterKey).applicationPages?.({ name: source.name, config: config.data }, posting.externalId)
  return pages ? ok(pages) : err(domainError('invalid_input', 'This source publishes no application form to fill.'))
}

/** One posting's stored form, with a fingerprint of the payload it was read from: a fill is tied to it (decision 0016). */
export async function getStoredApplicationForm(db: Db, posting: PostingRef): Promise<(StoredApplicationForm & { readonly fingerprint: string }) | null> {
  const [row] = await db.select({ form: applicationForms.form, payload: applicationForms.payload, fetchedAt: applicationForms.fetchedAt }).from(applicationForms)
    .where(and(eq(applicationForms.sourceId, posting.sourceId), eq(applicationForms.externalId, posting.externalId)))
  return row ? { form: row.form, fetchedAt: row.fetchedAt, fingerprint: contentHash(row.payload) } : null
}

export const postingKey = (posting: PostingRef): string => `${posting.sourceId}:${posting.externalId}`

/** Whether the posting's source publishes a structured application form at all. */
export async function sourcePublishesForms(db: Db, sourceId: string): Promise<boolean> {
  const [source] = await db.select({ adapterKey: jobSources.adapterKey }).from(jobSources).where(eq(jobSources.id, sourceId))
  return source !== undefined && getAdapter(source.adapterKey).fetchApplicationForm !== undefined
}
