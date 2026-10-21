import { randomUUID } from 'node:crypto'
import { and, desc, eq, getTableColumns, gt, inArray, max, sql } from 'drizzle-orm'
import type { TenantScope } from '@/lib/db/tenancy'
import { domainError, err, ok, type Result } from '@/lib/result'
import type { ModelTrace } from '@/modules/ai'
import { resumeParses, resumes } from './schema.js'
import { removeFile, sha256, storageKeyFor, storeFile } from './storage.js'
import { extractResumeText } from './text-extraction.js'
import {
  MAX_RESUME_BYTES,
  PARSE_LEASE_MS,
  type Resume,
  type ResumeParse,
  type ResumeSummary,
  type ResumeWithText,
  type UploadResume,
} from './types.js'

type ResumeRow = typeof resumes.$inferSelect
type ParseRow = typeof resumeParses.$inferSelect

function toResume(row: Omit<ResumeRow, 'extractedText'>): Resume {
  return {
    id: row.id,
    userId: row.userId,
    version: row.version,
    parentId: row.parentId,
    isMaster: row.isMaster,
    filename: row.filename,
    contentType: row.contentType,
    byteSize: row.byteSize,
    contentSha256: row.contentSha256,
    storageKey: row.storageKey,
    textExtractor: row.textExtractor,
    createdAt: row.createdAt,
  }
}

function toParse(row: ParseRow): ResumeParse {
  return {
    id: row.id,
    userId: row.userId,
    resumeId: row.resumeId,
    task: row.task,
    taskVersion: row.taskVersion,
    status: row.status,
    leaseExpiresAt: row.leaseExpiresAt,
    result: row.result,
    traces: row.traces,
    model: row.model,
    costMicroUsd: row.costMicroUsd,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  }
}

// Every column except the (large) extracted text, for list views.
const { extractedText: _omitted, ...resumeColumns } = getTableColumns(resumes)

// Uploads, parse starts, and file cleanup must not race a deletion for this tenant.
async function lockResumeChanges(scope: TenantScope): Promise<void> {
  await scope.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`resumes:${scope.userId}`}, 0))`)
}

/**
 * Stores a new immutable version. Rejects anything that is not a text-bearing
 * PDF or DOCX up front, so a scanned resume fails here rather than in a parse.
 * Every upload is a master; the current resume is the highest version.
 */
export async function uploadResume(
  scope: TenantScope,
  input: UploadResume,
  options: { readonly storageRoot: string },
): Promise<Result<Resume>> {
  if (input.bytes.byteLength === 0) return err(domainError('invalid_input', 'The file is empty.'))
  if (input.bytes.byteLength > MAX_RESUME_BYTES) {
    return err(domainError('invalid_input', 'Resumes must be 5 MB or smaller.'))
  }
  const extracted = await extractResumeText(input.bytes)
  if (!extracted.ok) return extracted

  await lockResumeChanges(scope)
  const contentSha256 = sha256(input.bytes)
  const storageKey = storageKeyFor(scope.userId, contentSha256)
  // Written before the row: an orphaned file is harmless, a row without its file is not.
  await storeFile(options.storageRoot, storageKey, input.bytes)

  const [latest] = await scope.db.select({ version: max(resumes.version) }).from(resumes)
  const [row] = await scope.db
    .insert(resumes)
    .values({
      userId: scope.userId,
      version: (latest?.version ?? 0) + 1,
      parentId: null,
      isMaster: true,
      storageKey,
      filename: input.filename,
      contentType: extracted.value.contentType,
      byteSize: input.bytes.byteLength,
      contentSha256,
      extractedText: extracted.value.text,
      textExtractor: extracted.value.extractor,
    })
    .returning(resumeColumns)
  if (!row) throw new Error('insert ... returning produced no row')
  return ok(toResume(row))
}

/** Newest first, each with the state of its most recent parse. */
export async function listResumes(scope: TenantScope): Promise<ResumeSummary[]> {
  const rows = await scope.db.select(resumeColumns).from(resumes).orderBy(desc(resumes.version))
  if (rows.length === 0) return []

  const parses = await scope.db
    .select()
    .from(resumeParses)
    .where(inArray(resumeParses.resumeId, rows.map((r) => r.id)))
    .orderBy(desc(resumeParses.startedAt))
  return rows.map((row) => {
    const parse = parses.find((p) => p.resumeId === row.id)
    return {
      ...toResume(row),
      latestParse: parse
        ? {
            id: parse.id,
            status: parse.status,
            leaseExpiresAt: parse.leaseExpiresAt,
            errorMessage: parse.errorMessage,
            completedAt: parse.completedAt,
          }
        : null,
    }
  })
}

export async function getResume(scope: TenantScope, resumeId: string): Promise<Result<ResumeWithText>> {
  const [row] = await scope.db.select().from(resumes).where(eq(resumes.id, resumeId))
  return row
    ? ok({ ...toResume(row), extractedText: row.extractedText })
    : err(domainError('not_found', `resume ${resumeId} not found`))
}

/** Source cleanup stays inside the module that owns career items. */
export async function deleteResume(
  scope: TenantScope,
  resumeId: string,
  prepareCareerItems: (scope: TenantScope, resumeId: string) => Promise<void>,
): Promise<Result<string>> {
  await lockResumeChanges(scope)
  const resume = await getResume(scope, resumeId)
  if (!resume.ok) return resume
  // An expired lease means the worker died; its run must not block deletion forever.
  const [running] = await scope.db.select({ id: resumeParses.id }).from(resumeParses)
    .where(and(eq(resumeParses.resumeId, resumeId), gt(resumeParses.leaseExpiresAt, sql`clock_timestamp()`))).limit(1)
  if (running) return err(domainError('conflict', 'This resume is being read. Wait for parsing to finish before deleting it.'))
  const [derived] = await scope.db.select({ id: resumes.id }).from(resumes)
    .where(eq(resumes.parentId, resumeId)).limit(1)
  if (derived) return err(domainError('conflict', 'Delete the versions derived from this resume first.'))
  await prepareCareerItems(scope, resumeId)
  await scope.db.delete(resumes).where(eq(resumes.id, resumeId))
  return ok(resume.value.storageKey)
}

/** Run after the deletion commits, so a rollback never leaves a resume without its file. */
export async function removeUnusedResumeFile(
  scope: TenantScope,
  storageKey: string,
  storageRoot: string,
): Promise<Result<void>> {
  const prefix = `resumes/${scope.userId}/`
  if (!storageKey.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(storageKey.slice(prefix.length))) {
    return err(domainError('invalid_input', 'Invalid resume storage key.'))
  }
  await lockResumeChanges(scope)
  const [reference] = await scope.db.select({ id: resumes.id }).from(resumes)
    .where(eq(resumes.storageKey, storageKey)).limit(1)
  if (reference) return ok(undefined)
  try {
    await removeFile(storageRoot, storageKey)
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'The resume was deleted, but its stored file could not be removed.'))
  }
}

export async function getLatestParse(scope: TenantScope, resumeId: string): Promise<ResumeParse | null> {
  const [row] = await scope.db
    .select()
    .from(resumeParses)
    .where(eq(resumeParses.resumeId, resumeId))
    .orderBy(desc(resumeParses.startedAt))
    .limit(1)
  return row ? toParse(row) : null
}

export type ParseStart =
  | { readonly kind: 'already_succeeded' }
  /** Another worker holds a live lease on this run. */
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'started'; readonly parseId: string; readonly attemptId: string; readonly resume: ResumeWithText }

/** Proof of ownership of a running parse. Every write to the run after the claim requires it. */
export type ParseAttempt = { readonly parseId: string; readonly attemptId: string }

// Lease times use the wall clock, not now(), which is frozen at the start of a transaction.
const leaseUntil = (leaseMs: number) => sql`clock_timestamp() + ${leaseMs}::int * interval '1 millisecond'`

/**
 * Claims a parse run for one attempt. Safe to call repeatedly: a succeeded run is
 * never restarted, a run under a live lease is left to its worker, and a failed run
 * or one whose lease lapsed is resumed on the same row under a new attempt id.
 */
export async function startParse(
  scope: TenantScope,
  { leaseMs = PARSE_LEASE_MS, ...input }: {
    readonly resumeId: string
    readonly task: string
    readonly taskVersion: number
    readonly leaseMs?: number
  },
): Promise<Result<ParseStart>> {
  await lockResumeChanges(scope)
  const resume = await getResume(scope, input.resumeId)
  if (!resume.ok) return resume

  const attemptId = randomUUID()
  const claim = { status: 'running', attemptId, leaseExpiresAt: leaseUntil(leaseMs) } as const
  const [row] = await scope.db
    .insert(resumeParses)
    .values({ userId: scope.userId, ...input, ...claim })
    .onConflictDoUpdate({
      target: [resumeParses.resumeId, resumeParses.task, resumeParses.taskVersion],
      set: { ...claim, startedAt: sql`now()`, completedAt: null, errorCode: null, errorMessage: null },
      setWhere: sql`${resumeParses.status} = 'failed' or ${resumeParses.leaseExpiresAt} <= clock_timestamp()`,
    })
    .returning({ id: resumeParses.id })
  if (row) return ok({ kind: 'started', parseId: row.id, attemptId, resume: resume.value })

  const [existing] = await scope.db
    .select({ status: resumeParses.status })
    .from(resumeParses)
    .where(and(
      eq(resumeParses.resumeId, input.resumeId),
      eq(resumeParses.task, input.task),
      eq(resumeParses.taskVersion, input.taskVersion),
    ))
  return ok({ kind: existing?.status === 'succeeded' ? 'already_succeeded' : 'in_progress' })
}

const heldBy = (attempt: ParseAttempt) =>
  and(eq(resumeParses.id, attempt.parseId), eq(resumeParses.attemptId, attempt.attemptId), eq(resumeParses.status, 'running'))

const lostAttempt = (attempt: ParseAttempt) =>
  err(domainError('conflict', `parse ${attempt.parseId} is no longer held by attempt ${attempt.attemptId}`))

/** Extends the lease. `conflict` means the run finished or another attempt reclaimed it. */
export async function renewParseLease(
  scope: TenantScope,
  { leaseMs = PARSE_LEASE_MS, ...attempt }: ParseAttempt & { readonly leaseMs?: number },
): Promise<Result<void>> {
  const updated = await scope.db
    .update(resumeParses)
    .set({ leaseExpiresAt: leaseUntil(leaseMs) })
    .where(heldBy(attempt))
    .returning({ id: resumeParses.id })
  return updated.length > 0 ? ok(undefined) : lostAttempt(attempt)
}

// Failed attempts cost money too, so traces and cost accumulate across runs of the same row.
function traceColumns(traces: readonly ModelTrace[]) {
  return {
    traces: sql`${resumeParses.traces} || ${JSON.stringify(traces)}::jsonb`,
    costMicroUsd: sql`${resumeParses.costMicroUsd} + ${traces.reduce((sum, t) => sum + t.costMicroUsd, 0)}`,
    model: traces.at(-1)?.model ?? null,
  }
}

/**
 * Fails with `conflict` if this attempt no longer holds the run, so a worker that
 * lost its lease cannot overwrite the result of the attempt that replaced it.
 */
export async function completeParse(
  scope: TenantScope,
  input: ParseAttempt & { readonly result: unknown; readonly traces: readonly ModelTrace[] },
): Promise<Result<void>> {
  const updated = await scope.db
    .update(resumeParses)
    .set({
      status: 'succeeded',
      result: input.result,
      leaseExpiresAt: null,
      completedAt: sql`now()`,
      ...traceColumns(input.traces),
    })
    .where(heldBy(input))
    .returning({ id: resumeParses.id })
  return updated.length > 0 ? ok(undefined) : lostAttempt(input)
}

export async function failParse(
  scope: TenantScope,
  input: ParseAttempt & {
    readonly errorCode: string
    readonly errorMessage: string
    readonly traces: readonly ModelTrace[]
  },
): Promise<Result<void>> {
  const updated = await scope.db
    .update(resumeParses)
    .set({
      status: 'failed',
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      leaseExpiresAt: null,
      completedAt: sql`now()`,
      ...traceColumns(input.traces),
    })
    .where(heldBy(input))
    .returning({ id: resumeParses.id })
  return updated.length > 0 ? ok(undefined) : lostAttempt(input)
}
