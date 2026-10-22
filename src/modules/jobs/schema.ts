import { sql, type SQL } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { tenantIsolation } from '@/lib/db/tenancy'
import { jobSources, rawJobs } from '@/modules/job-sources'
import { users } from '@/modules/profiles'
import { EMPLOYMENT_TYPES, JOB_USER_STATES, LOCATION_POLICIES, SENIORITIES } from './types.js'

// Text plus a CHECK instead of a Postgres enum: enum values cannot be removed or renamed in place.
// Values are inlined as literals because DDL cannot take bind parameters; they are
// compile-time constants from the Zod enums, never user input.
const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', '))})`

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

/** Shared catalog: one row per posting for all users. No user_id, no RLS. */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').notNull().references(() => jobSources.id),
    externalId: text('external_id').notNull(),
    /** The raw version this row was normalized from. */
    rawJobId: uuid('raw_job_id').notNull().references(() => rawJobs.id),
    // Compared on every upsert so a retried job for an older version cannot overwrite a newer one.
    rawFetchedAt: timestamptz('raw_fetched_at').notNull(),
    companyName: text('company_name').notNull(),
    companyNormalized: text('company_normalized').notNull(),
    title: text('title').notNull(),
    titleNormalized: text('title_normalized').notNull(),
    seniority: text('seniority', { enum: SENIORITIES }),
    description: text('description').notNull(),
    locationPolicy: text('location_policy', { enum: LOCATION_POLICIES }).notNull(),
    locationText: text('location_text'),
    locationCountry: text('location_country'),
    // TODO(M1.6): decide whether extracted remote scope lives here or only on eligibility_assessments.
    remoteScope: jsonb('remote_scope'),
    employmentType: text('employment_type', { enum: EMPLOYMENT_TYPES }).notNull(),
    // bigint: minor units of weak currencies (IDR, VND) overflow a 32-bit integer.
    salaryMinMinor: bigint('salary_min_minor', { mode: 'number' }),
    salaryMaxMinor: bigint('salary_max_minor', { mode: 'number' }),
    salaryCurrency: text('salary_currency'),
    salarySource: text('salary_source', { enum: ['posted', 'unknown'] }).notNull(),
    applyUrl: text('apply_url').notNull(),
    postedAt: timestamptz('posted_at'),
    fingerprint: text('fingerprint').notNull(),
    canonicalJobId: uuid('canonical_job_id').references((): AnyPgColumn => jobs.id),
    firstSeenAt: timestamptz('first_seen_at').notNull(),
    lastSeenAt: timestamptz('last_seen_at').notNull(),
    closedAt: timestamptz('closed_at'),
  },
  (t) => [
    unique('jobs_source_external_key').on(t.sourceId, t.externalId),
    index('jobs_fingerprint_idx').on(t.fingerprint),
    index('jobs_canonical_job_id_idx').on(t.canonicalJobId),
    index('jobs_company_normalized_idx').on(t.companyNormalized),
    check('jobs_location_policy_check', oneOf(t.locationPolicy, LOCATION_POLICIES)),
    check('jobs_employment_type_check', oneOf(t.employmentType, EMPLOYMENT_TYPES)),
    check('jobs_seniority_check', oneOf(t.seniority, SENIORITIES)),
    check('jobs_location_country_check', sql`${t.locationCountry} ~ '^[A-Z]{2}$'`),
    // The database refuses an "unknown" salary that carries numbers, and a "posted" one without them.
    check(
      'jobs_salary_check',
      sql`(${t.salarySource} = 'unknown'
            and ${t.salaryMinMinor} is null and ${t.salaryMaxMinor} is null and ${t.salaryCurrency} is null)
          or (${t.salarySource} = 'posted'
            and ${t.salaryCurrency} is not null
            and (${t.salaryMinMinor} is not null or ${t.salaryMaxMinor} is not null)
            and (${t.salaryMinMinor} is null or ${t.salaryMaxMinor} is null
                 or ${t.salaryMinMinor} <= ${t.salaryMaxMinor}))`,
    ),
  ],
)

/** Per-user: a candidate's own action on a shared job. */
export const jobUserStates = pgTable(
  'job_user_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    state: text('state', { enum: JOB_USER_STATES }).notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // Leading user_id column doubles as the tenant index.
    unique('job_user_states_user_job_key').on(t.userId, t.jobId),
    check('job_user_states_state_check', oneOf(t.state, JOB_USER_STATES)),
    tenantIsolation(),
  ],
)
