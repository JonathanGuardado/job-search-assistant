import { sql, type SQL } from 'drizzle-orm'
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { tenantIsolation } from '@/lib/db/tenancy'
import type { ModelTrace } from '@/modules/ai'
import { jobs } from '@/modules/jobs'
import { users } from '@/modules/profiles'
import type { QuestionReading } from './question-reading.js'
import type { SavedAnswerValue } from './readiness.js'
import { ANSWER_ORIGINS, DRAFT_METHODS, DRAFT_STATUSES, type DraftBasis } from './types.js'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })
const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', '))})`

/** The standard fields every application form asks for, given once (decision 0013). */
export const applicantDetails = pgTable(
  'applicant_details',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .unique(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    linkedinUrl: text('linkedin_url'),
    githubUrl: text('github_url'),
    websiteUrl: text('website_url'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  () => [tenantIsolation()],
)

/**
 * The candidate's own answers, one per question as worded (readiness.questionKey), reused
 * for every form that asks it. May hold sensitive answers (demographics); never shared.
 */
export const savedAnswers = pgTable(
  'saved_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionKey: text('question_key').notNull(),
    /** The question as first answered, for showing it back. */
    label: text('label').notNull(),
    answer: jsonb('answer').$type<SavedAnswerValue>().notNull(),
    /** Whether the candidate wrote it or accepted a draft: unattended sending treats them differently (decision 0014). */
    origin: text('origin', { enum: ANSWER_ORIGINS }).notNull().default('owner'),
    draftId: uuid('draft_id').references((): AnyPgColumn => answerDrafts.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('saved_answers_user_question_key').on(t.userId, t.questionKey),
    check('saved_answers_origin_check', oneOf(t.origin, ANSWER_ORIGINS)),
    check('saved_answers_draft_check', sql`${t.draftId} is null or ${t.origin} = 'draft'`),
    tenantIsolation(),
  ],
)

/**
 * One run of the "same question, different wording" task: which unanswered questions ask
 * what a saved answer already answers. The newest run for the current inputs is used; the
 * candidate accepts or ignores each suggestion.
 */
export const questionMatchRuns = pgTable(
  'question_match_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Digest of the unanswered and saved question keys it compared: other inputs, another run. */
    inputsHash: text('inputs_hash').notNull(),
    taskVersion: integer('task_version').notNull(),
    /** unanswered question key → saved question key it matches. */
    matches: jsonb('matches').$type<Record<string, string>>().notNull(),
    traces: jsonb('traces').$type<ModelTrace[]>().notNull(),
    model: text('model'),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [unique('question_match_runs_user_inputs_key').on(t.userId, t.inputsHash, t.taskVersion), tenantIsolation()],
)

/**
 * What an application question asks (decision 0014), read once per wording and options and
 * shared by every candidate: the question is the same question for all of them. A batch's
 * traces are stored on each reading it produced, with the batch's cost split between them.
 */
export const questionReadings = pgTable(
  'question_readings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Digest of the label, description, field types and option labels. */
    questionHash: text('question_hash').notNull(),
    taskVersion: integer('task_version').notNull(),
    reading: jsonb('reading').$type<QuestionReading>().notNull(),
    traces: jsonb('traces').$type<ModelTrace[]>().notNull(),
    model: text('model'),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [unique('question_readings_hash_version_key').on(t.questionHash, t.taskVersion)],
)

/**
 * A draft answer for one of the candidate's questions (decision 0014), or the reason there is
 * none. Rows are added, not updated: the newest for a question is current, and a draft that
 * was accepted stays the evidence for the saved answer that points at it.
 */
export const answerDrafts = pgTable(
  'answer_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionKey: text('question_key').notNull(),
    label: text('label').notNull(),
    method: text('method', { enum: DRAFT_METHODS }).notNull(),
    /** Motivation drafts are per job; the others serve every job asking the question. */
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    status: text('status', { enum: DRAFT_STATUSES }).notNull(),
    answer: jsonb('answer').$type<SavedAnswerValue>(),
    basis: jsonb('basis').$type<DraftBasis>().notNull(),
    reason: text('reason'),
    /** Digest of what the draft was made from: a run adds a row only when this differs from the newest one's. */
    inputsHash: text('inputs_hash').notNull(),
    readingId: uuid('reading_id').references(() => questionReadings.id),
    taskVersion: integer('task_version'),
    traces: jsonb('traces').$type<ModelTrace[]>().notNull().default(sql`'[]'::jsonb`),
    model: text('model'),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('answer_drafts_user_question_idx').on(t.userId, t.questionKey, t.createdAt),
    check('answer_drafts_method_check', oneOf(t.method, DRAFT_METHODS)),
    check('answer_drafts_status_check', oneOf(t.status, DRAFT_STATUSES)),
    check('answer_drafts_answer_check', sql`(${t.status} = 'drafted') = (${t.answer} is not null)`),
    check('answer_drafts_reason_check', sql`(${t.status} = 'drafted') = (${t.reason} is null)`),
    tenantIsolation(),
  ],
)
