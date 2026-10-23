import { sql, type SQL } from 'drizzle-orm'
import { bigint, check, date, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { tenantIsolation } from '@/lib/db/tenancy'
import { rawJobs } from '@/modules/job-sources'
import { jobs } from '@/modules/jobs'
import { users } from '@/modules/profiles'
import { resumes } from '@/modules/resumes'
import { APPLICATION_STATUSES, type Contact } from './types.js'

const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', '))})`

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

/**
 * One per job the candidate applied to. Never deleted (the app role has no DELETE): a
 * mistaken entry is withdrawn, so its history stays whole (decision 0012).
 */
export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').notNull().references(() => jobs.id),
    /** The posting version applied to: rebuilt from raw_jobs after the posting goes offline. */
    rawJobId: uuid('raw_job_id').notNull().references(() => rawJobs.id),
    status: text('status', { enum: APPLICATION_STATUSES }).notNull(),
    appliedOn: date('applied_on', { mode: 'string' }).notNull(),
    /** Set null if the candidate later deletes that resume version; the rest of the record stands. */
    resumeId: uuid('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    salaryAskedMinor: bigint('salary_asked_minor', { mode: 'number' }),
    salaryAskedCurrency: text('salary_asked_currency'),
    sourceUrl: text('source_url').notNull(),
    contact: jsonb('contact').$type<Contact>(),
    notes: text('notes'),
    outcomeReason: text('outcome_reason'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('applications_user_job_key').on(t.userId, t.jobId),
    // Target of application_events' (application, user) key.
    unique('applications_id_user_key').on(t.id, t.userId),
    check('applications_status_check', oneOf(t.status, APPLICATION_STATUSES)),
    check('applications_salary_check', sql`(${t.salaryAskedMinor} is null) = (${t.salaryAskedCurrency} is null) and (${t.salaryAskedMinor} is null or ${t.salaryAskedMinor} >= 0)`),
    tenantIsolation(),
  ],
)

/**
 * Append-only: every stage an application moved through. The app role has no UPDATE or
 * DELETE on it, so history cannot be rewritten. Time-in-stage comes from here.
 */
export const applicationEvents = pgTable(
  'application_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    applicationId: uuid('application_id').notNull(),
    fromStatus: text('from_status', { enum: APPLICATION_STATUSES }),
    toStatus: text('to_status', { enum: APPLICATION_STATUSES }).notNull(),
    note: text('note'),
    /** The day it happened, as the candidate says; recordedAt is when it was written down. */
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
  },
  (t) => [
    // A foreign key bypasses row-level security, so the key includes the user: an event can
    // only belong to the same candidate's application.
    foreignKey({ name: 'application_events_application_fk', columns: [t.applicationId, t.userId], foreignColumns: [applications.id, applications.userId] }),
    // Leading user_id doubles as the tenant index.
    index('application_events_user_application_idx').on(t.userId, t.applicationId),
    check('application_events_to_status_check', oneOf(t.toStatus, APPLICATION_STATUSES)),
    check('application_events_from_status_check', sql`${t.fromStatus} is null or ${oneOf(t.fromStatus, APPLICATION_STATUSES)}`),
    check('application_events_change_check', sql`${t.fromStatus} is distinct from ${t.toStatus}`),
    tenantIsolation(),
  ],
)
