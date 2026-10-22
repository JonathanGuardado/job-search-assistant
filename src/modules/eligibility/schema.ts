import { sql, type SQL } from 'drizzle-orm'
import {
  bigint,
  check,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { tenantIsolation } from '@/lib/db/tenancy'
import type { ModelTrace } from '@/modules/ai'
import { jobs } from '@/modules/jobs'
import { users } from '@/modules/profiles'
import { ASSESSMENT_STAGES, VERDICTS, type AssessmentReasons, type EligibilityClaims, type Evidence } from './types.js'

const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', '))})`

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

/**
 * Shared: what a posting states, extracted once and reused for every candidate (D6).
 * Holds no candidate data, so no user_id. Re-extracted when the job's text changes.
 */
export const jobEligibilityClaims = pgTable(
  'job_eligibility_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').notNull().references(() => jobs.id),
    taskVersion: integer('task_version').notNull(),
    /** The job's fingerprint when extracted; a different one means the text changed. */
    jobFingerprint: text('job_fingerprint').notNull(),
    /** As the model returned them. Quotes are re-validated on every assessment. */
    claims: jsonb('claims').$type<EligibilityClaims>().notNull(),
    traces: jsonb('traces').$type<ModelTrace[]>().notNull(),
    model: text('model'),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull(),
    extractedAt: timestamptz('extracted_at').notNull().defaultNow(),
  },
  (t) => [unique('job_eligibility_claims_job_task_key').on(t.jobId, t.taskVersion)],
)

/** Per user: one verdict per job and engine version, with its evidence (CLAUDE.md rule 4). */
export const eligibilityAssessments = pgTable(
  'eligibility_assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').notNull().references(() => jobs.id),
    engineVersion: integer('engine_version').notNull(),
    verdict: text('verdict', { enum: VERDICTS }).notNull(),
    confidence: real('confidence').notNull(),
    stage: text('stage', { enum: ASSESSMENT_STAGES }).notNull(),
    reasons: jsonb('reasons').$type<AssessmentReasons>().notNull(),
    evidence: jsonb('evidence').$type<readonly Evidence[]>().notNull(),
    /** Null when structured fields decided it without reading the posting. */
    claimsId: uuid('claims_id').references(() => jobEligibilityClaims.id),
    promptVersion: integer('prompt_version'),
    model: text('model'),
    // Inputs at assessment time: a change in either makes the verdict stale.
    jobFingerprint: text('job_fingerprint').notNull(),
    profileHash: text('profile_hash').notNull(),
    assessedAt: timestamptz('assessed_at').notNull().defaultNow(),
    /** The user's own verdict from the Skipped Jobs view (1.8). Re-assessment never clears it. */
    userOverride: text('user_override', { enum: VERDICTS }),
    overrideReason: text('override_reason'),
  },
  (t) => [
    unique('eligibility_assessments_user_job_engine_key').on(t.userId, t.jobId, t.engineVersion),
    check('eligibility_assessments_verdict_check', oneOf(t.verdict, VERDICTS)),
    check('eligibility_assessments_stage_check', oneOf(t.stage, ASSESSMENT_STAGES)),
    check('eligibility_assessments_override_check', sql`${t.userOverride} is null or ${oneOf(t.userOverride, VERDICTS)}`),
    check('eligibility_assessments_confidence_check', sql`${t.confidence} between 0 and 1`),
    tenantIsolation(),
  ],
)
