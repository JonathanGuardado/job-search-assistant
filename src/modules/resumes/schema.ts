import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { tenantIsolation } from '@/lib/db/tenancy'
import type { ModelTrace } from '@/modules/ai'
import { users } from '@/modules/profiles'
import { MAX_RESUME_BYTES, PARSE_STATUSES, RESUME_CONTENT_TYPES } from './types.js'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

const literals = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', '))

/**
 * Immutable versions. A custom migration revokes UPDATE from the app role, so
 * "never edit in place" is enforced by the database, not by convention.
 * The extracted text lives here because it is a pure function of the file.
 */
export const resumes = pgTable(
  'resumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    // Tailored versions (phase 2) point at the master they were derived from.
    parentId: uuid('parent_id').references((): AnyPgColumn => resumes.id),
    isMaster: boolean('is_master').notNull(),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type', { enum: RESUME_CONTENT_TYPES }).notNull(),
    byteSize: integer('byte_size').notNull(),
    contentSha256: text('content_sha256').notNull(),
    extractedText: text('extracted_text').notNull(),
    textExtractor: text('text_extractor').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('resumes_user_version_key').on(t.userId, t.version),
    check('resumes_content_type_check', sql`${t.contentType} in (${literals(RESUME_CONTENT_TYPES)})`),
    check('resumes_byte_size_check', sql`${t.byteSize} > 0 and ${t.byteSize} <= ${sql.raw(String(MAX_RESUME_BYTES))}`),
    // A master is never derived from another version; a tailored one always is.
    check('resumes_master_check', sql`${t.isMaster} = (${t.parentId} is null)`),
    tenantIsolation(),
  ],
)

/**
 * One run of a parse task. Mutable status; a better prompt version is a new row.
 * A worker owns a running row only while its lease is live (decision 0007): each
 * claim issues a new attempt id, and only that attempt may renew, complete, or fail it.
 */
export const resumeParses = pgTable(
  'resume_parses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    resumeId: uuid('resume_id')
      .notNull()
      .references(() => resumes.id, { onDelete: 'cascade' }),
    task: text('task').notNull(),
    taskVersion: integer('task_version').notNull(),
    status: text('status', { enum: PARSE_STATUSES }).notNull(),
    attemptId: uuid('attempt_id').notNull().defaultRandom(),
    leaseExpiresAt: timestamptz('lease_expires_at'),
    result: jsonb('result'),
    traces: jsonb('traces').$type<ModelTrace[]>().notNull().default([]),
    model: text('model'),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    completedAt: timestamptz('completed_at'),
  },
  (t) => [
    unique('resume_parses_resume_task_key').on(t.resumeId, t.task, t.taskVersion),
    check('resume_parses_status_check', sql`${t.status} in (${literals(PARSE_STATUSES)})`),
    check('resume_parses_lease_check', sql`(${t.status} = 'running') = (${t.leaseExpiresAt} is not null)`),
    tenantIsolation(),
  ],
)
