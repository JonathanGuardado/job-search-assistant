import { bigint, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { tenantIsolation } from '@/lib/db/tenancy'
import type { ModelTrace } from '@/modules/ai'
import { users } from '@/modules/profiles'
import type { SavedAnswerValue } from './readiness.js'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

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
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('saved_answers_user_question_key').on(t.userId, t.questionKey), tenantIsolation()],
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
