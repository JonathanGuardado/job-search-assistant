import { sql, type SQL } from 'drizzle-orm'
import { bigint, check, integer, jsonb, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { tenantIsolation } from '@/lib/db/tenancy'
import type { ModelTrace } from '@/modules/ai'
import { jobs } from '@/modules/jobs'
import { users } from '@/modules/profiles'
import { SALARY_COMPATIBILITIES, type Dimensions, type Finding, type JobRequirements } from './types.js'

const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', '))})`

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

/**
 * Shared: what a posting asks of a candidate, extracted once per text version and reused
 * for every candidate (decision 0010). Holds no candidate data, so no user_id.
 */
export const jobRequirements = pgTable(
  'job_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').notNull().references(() => jobs.id),
    taskVersion: integer('task_version').notNull(),
    /** The job's fingerprint when extracted; a different one means the text changed. */
    jobFingerprint: text('job_fingerprint').notNull(),
    /** As the model returned them. Quotes are re-validated on every comparison. */
    requirements: jsonb('requirements').$type<JobRequirements>().notNull(),
    traces: jsonb('traces').$type<ModelTrace[]>().notNull(),
    model: text('model'),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull(),
    extractedAt: timestamptz('extracted_at').notNull().defaultNow(),
  },
  (t) => [unique('job_requirements_job_task_key').on(t.jobId, t.taskVersion)],
)

/** Per user: one comparison per job and engine version, with its evidence. No overall score (docs/domain-model.md). */
export const matchAssessments = pgTable(
  'match_assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').notNull().references(() => jobs.id),
    engineVersion: integer('engine_version').notNull(),
    dimensions: jsonb('dimensions').$type<Dimensions>().notNull(),
    metRequirements: jsonb('met_requirements').$type<readonly Finding[]>().notNull(),
    missingRequirements: jsonb('missing_requirements').$type<readonly Finding[]>().notNull(),
    concerns: text('concerns').array().notNull(),
    salaryCompatibility: text('salary_compatibility', { enum: SALARY_COMPATIBILITIES }).notNull(),
    /** Null when the posting could not be read: the text-based dimensions are then unknown. */
    requirementsId: uuid('requirements_id').references(() => jobRequirements.id),
    promptVersion: integer('prompt_version'),
    model: text('model'),
    // Inputs at assessment time: a change in either makes the match stale.
    jobFingerprint: text('job_fingerprint').notNull(),
    /** Digest of the matching-relevant profile fields and the career record. */
    inputsHash: text('inputs_hash').notNull(),
    assessedAt: timestamptz('assessed_at').notNull().defaultNow(),
  },
  (t) => [
    unique('match_assessments_user_job_engine_key').on(t.userId, t.jobId, t.engineVersion),
    check('match_assessments_salary_check', oneOf(t.salaryCompatibility, SALARY_COMPATIBILITIES)),
    tenantIsolation(),
  ],
)
