import { sql, type SQL } from 'drizzle-orm'
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { tenantIsolation } from '@/lib/db/tenancy'
import type { Packet } from '@/modules/application-answers'
import { applications } from '@/modules/applications'
import { rawJobs } from '@/modules/job-sources'
import { jobs } from '@/modules/jobs'
import { users } from '@/modules/profiles'
import { FILL_OUTCOMES, FILL_STATUSES, IN_PROGRESS, type CapturedSubmission, type FillReport, type OutcomeEvidence } from './types.js'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })
const quoted = (values: readonly string[]) => sql.raw(values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', '))
const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL => sql`${column} in (${quoted(values)})`

/**
 * One attempt to fill a job's application form in a visible browser that the owner submits
 * (decision 0016). Updated as it moves through its statuses; never deleted, so every attempt
 * stays as evidence.
 */
export const applicationFills = pgTable(
  'application_fills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').notNull().references(() => jobs.id),
    /** The posting version reviewed: the application records it. */
    rawJobId: uuid('raw_job_id').notNull().references(() => rawJobs.id),
    /** Of the stored form's payload when reviewed. */
    formFingerprint: text('form_fingerprint').notNull(),
    /** What the owner reviewed, exactly what the browser enters. */
    packet: jsonb('packet').$type<Packet>().notNull(),
    packetHash: text('packet_hash').notNull(),
    status: text('status', { enum: FILL_STATUSES }).notNull(),
    /** The worker holding the browser, until the lease expires. */
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamptz('lease_expires_at'),
    fillReport: jsonb('fill_report').$type<FillReport>(),
    submission: jsonb('submission').$type<CapturedSubmission>(),
    outcome: text('outcome', { enum: FILL_OUTCOMES }),
    outcomeEvidence: jsonb('outcome_evidence').$type<OutcomeEvidence>(),
    applicationId: uuid('application_id'),
    error: text('error'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // A foreign key bypasses row-level security, so the key includes the user (as application_events do).
    foreignKey({ name: 'application_fills_application_fk', columns: [t.applicationId, t.userId], foreignColumns: [applications.id, applications.userId] }),
    // One fill in progress per person and job, counting a submitted one whose application is not recorded yet.
    uniqueIndex('application_fills_in_progress_key').on(t.userId, t.jobId)
      .where(sql`${t.status} in (${quoted(IN_PROGRESS)}) or (${t.status} = 'submitted' and ${t.applicationId} is null)`),
    index('application_fills_user_job_idx').on(t.userId, t.jobId, t.createdAt),
    check('application_fills_status_check', oneOf(t.status, FILL_STATUSES)),
    check('application_fills_outcome_check', sql`${t.outcome} is null or ${oneOf(t.outcome, FILL_OUTCOMES)}`),
    check('application_fills_lease_check', sql`(${t.leaseOwner} is null) = (${t.leaseExpiresAt} is null)`),
    check('application_fills_application_check', sql`${t.applicationId} is null or ${t.status} = 'submitted'`),
    tenantIsolation(),
  ],
)
