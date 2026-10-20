import { sql } from 'drizzle-orm'
import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenantIsolation } from '@/lib/db/tenancy'
import { users } from '@/modules/profiles'
import { resumeParses, resumes } from '@/modules/resumes'
import { CAREER_ITEM_TYPES, PARTIAL_DATE_PATTERN, type Evidence } from './types.js'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })
const textArray = (name: string) => text(name).array().notNull().default(sql`'{}'::text[]`)
const literals = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', '))
// A NULL date passes the CHECK (NULL ~ pattern is NULL), which is what "not stated" needs.
const partialDate = sql.raw(`'${PARTIAL_DATE_PATTERN.replaceAll("'", "''")}'`)

/**
 * The grounding source for all generated text (CLAUDE.md rule 1). Parsed items
 * arrive unverified; only the user's confirmation sets verified_by_user.
 */
export const careerItems = pgTable(
  'career_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: CAREER_ITEM_TYPES }).notNull(),
    organization: text('organization'),
    title: text('title'),
    startedOn: text('started_on'),
    endedOn: text('ended_on'),
    isCurrent: boolean('is_current').notNull().default(false),
    summary: text('summary'),
    achievements: textArray('achievements'),
    technologies: textArray('technologies'),
    // Structured metrics are not extracted yet; achievements carry them verbatim.
    metrics: jsonb('metrics').notNull().default([]),
    evidence: jsonb('evidence').$type<Evidence>().notNull(),
    // Verified items outlive the resume they came from.
    sourceResumeId: uuid('source_resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    sourceParseId: uuid('source_parse_id').references(() => resumeParses.id, { onDelete: 'set null' }),
    verifiedByUser: boolean('verified_by_user').notNull().default(false),
    verifiedAt: timestamptz('verified_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // Leading user_id column doubles as the tenant index.
    index('career_items_user_resume_idx').on(t.userId, t.sourceResumeId),
    check('career_items_type_check', sql`${t.type} in (${literals(CAREER_ITEM_TYPES)})`),
    check('career_items_started_on_check', sql`${t.startedOn} ~ ${partialDate}`),
    check('career_items_ended_on_check', sql`${t.endedOn} ~ ${partialDate}`),
    check('career_items_current_check', sql`not ${t.isCurrent} or ${t.endedOn} is null`),
    check('career_items_verified_check', sql`${t.verifiedByUser} = (${t.verifiedAt} is not null)`),
    tenantIsolation(),
  ],
)
