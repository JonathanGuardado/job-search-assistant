import { and, desc, eq, getTableColumns, inArray, max, sql } from 'drizzle-orm'
import type { TenantScope } from '@/lib/db/tenancy'
import { domainError, err, ok, type Result } from '@/lib/result'
import type { ModelTrace } from '@/modules/ai'
import { resumeParses, resumes } from './schema.js'
import { removeFile, sha256, storageKeyFor, storeFile } from './storage.js'
import { extractResumeText } from './text-extraction.js'
import {
  MAX_RESUME_BYTES,
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
        ? { id: parse.id, status: parse.status, errorMessage: parse.errorMessage, completedAt: parse.completedAt }
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
  const [running] = await scope.db.select({ id: resumeParses.id }).from(resumeParses)
    .where(and(eq(resumeParses.resumeId, resumeId), eq(resumeParses.status, 'running'))).limit(1)
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
  | { readonly kind: 'started'; readonly parseId: string; readonly resume: ResumeWithText }

/**
 * Claims a parse run. Safe to call repeatedly: a succeeded run is never
 * restarted, and a failed or interrupted one is resumed on the same row.
 */
export async function startParse(
  scope: TenantScope,
  input: { readonly resumeId: string; readonly task: string; readonly taskVersion: number },
): Promise<Result<ParseStart>> {
  await lockResumeChanges(scope)
  const resume = await getResume(scope, input.resumeId)
  if (!resume.ok) return resume

  const [row] = await scope.db
    .insert(resumeParses)
    .values({ userId: scope.userId, ...input, status: 'running' })
    .onConflictDoUpdate({
      target: [resumeParses.resumeId, resumeParses.task, resumeParses.taskVersion],
      set: { status: 'running', startedAt: sql`now()`, completedAt: null, errorCode: null, errorMessage: null },
      setWhere: sql`${resumeParses.status} <> 'succeeded'`,
    })
    .returning({ id: resumeParses.id })
  return ok(row ? { kind: 'started', parseId: row.id, resume: resume.value } : { kind: 'already_succeeded' })
}

// Failed attempts cost money too, so traces and cost accumulate across runs of the same row.
function traceColumns(traces: readonly ModelTrace[]) {
  return {
    traces: sql`${resumeParses.traces} || ${JSON.stringify(traces)}::jsonb`,
    costMicroUsd: sql`${resumeParses.costMicroUsd} + ${traces.reduce((sum, t) => sum + t.costMicroUsd, 0)}`,
    model: traces.at(-1)?.model ?? null,
  }
}

/** Fails with `conflict` if the run is no longer running (another worker finished it). */
export async function completeParse(
  scope: TenantScope,
  input: { readonly parseId: string; readonly result: unknown; readonly traces: readonly ModelTrace[] },
): Promise<Result<void>> {
  const updated = await scope.db
    .update(resumeParses)
    .set({ status: 'succeeded', result: input.result, completedAt: sql`now()`, ...traceColumns(input.traces) })
    .where(and(eq(resumeParses.id, input.parseId), eq(resumeParses.status, 'running')))
    .returning({ id: resumeParses.id })
  return updated.length > 0
    ? ok(undefined)
    : err(domainError('conflict', `parse ${input.parseId} is not running`))
}

export async function failParse(
  scope: TenantScope,
  input: {
    readonly parseId: string
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
      completedAt: sql`now()`,
      ...traceColumns(input.traces),
    })
    .where(and(eq(resumeParses.id, input.parseId), eq(resumeParses.status, 'running')))
    .returning({ id: resumeParses.id })
  return updated.length > 0
    ? ok(undefined)
    : err(domainError('conflict', `parse ${input.parseId} is not running`))
}
