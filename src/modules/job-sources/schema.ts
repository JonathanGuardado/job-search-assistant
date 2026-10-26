import { sql, type SQL } from 'drizzle-orm'
import {
  boolean,
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { ADAPTER_KEYS, type AdapterConfig, type ApplicationForm } from './adapter.js'
import { SOURCE_HEALTH_STATUSES } from './types.js'

const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', '))})`

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

/** Shared catalog: a board is polled once for every user. No user_id, no RLS. */
export const jobSources = pgTable(
  'job_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adapterKey: text('adapter_key', { enum: ADAPTER_KEYS }).notNull(),
    /** Shown in the UI and used as every job's company name (boards label themselves inconsistently). */
    name: text('name').notNull(),
    config: jsonb('config').$type<AdapterConfig>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** The next page of a poll in progress; null between polls. */
    cursor: text('cursor'),
    /** When the last poll fetched its final page. */
    lastPolledAt: timestamptz('last_polled_at'),
    healthStatus: text('health_status', { enum: SOURCE_HEALTH_STATUSES }).notNull().default('unknown'),
    healthMessage: text('health_message'),
    healthCheckedAt: timestamptz('health_checked_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('job_sources_adapter_key_check', oneOf(t.adapterKey, ADAPTER_KEYS)),
    check('job_sources_health_status_check', oneOf(t.healthStatus, SOURCE_HEALTH_STATUSES)),
    uniqueIndex('job_sources_adapter_token_key').on(t.adapterKey, sql`(${t.config}->>'token')`),
  ],
)

/**
 * Verbatim capture, the replay log for normalization. Never mutated: a custom
 * migration revokes UPDATE and DELETE from the app role. A changed posting is a
 * new row; an unchanged repoll hits the unique key and inserts nothing.
 */
export const rawJobs = pgTable(
  'raw_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => jobSources.id),
    externalId: text('external_id').notNull(),
    payload: jsonb('payload').notNull(),
    /** sha256 hex of the payload's canonical JSON (content-hash.ts). */
    contentHash: text('content_hash').notNull(),
    fetchedAt: timestamptz('fetched_at').notNull(),
  },
  (t) => [unique('raw_jobs_source_external_hash_key').on(t.sourceId, t.externalId, t.contentHash)],
)

/**
 * Shared catalog: each posting's application form as the source last published it
 * (decision 0013). Holds no candidate data. Unlike raw_jobs it is a refreshed copy, not a
 * log: the payload is kept verbatim so the form can be re-read, and replaced on refresh.
 */
export const applicationForms = pgTable(
  'application_forms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => jobSources.id),
    externalId: text('external_id').notNull(),
    payload: jsonb('payload').notNull(),
    form: jsonb('form').$type<ApplicationForm>().notNull(),
    fetchedAt: timestamptz('fetched_at').notNull(),
  },
  (t) => [unique('application_forms_source_external_key').on(t.sourceId, t.externalId)],
)
