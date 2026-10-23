import { sql } from 'drizzle-orm'
import { boolean, check, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenantIsolation } from '@/lib/db/tenancy'
import type { CandidateProfileInput, ConstraintModes, WorkAuthorization } from './types.js'

/**
 * The tenant list. Not row-level secured: it holds no candidate data, and
 * fan-out jobs read it to enqueue one tenant-scoped job per user.
 * Candidate constraints arrive in milestone 1.2 as `candidate_profiles`.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const candidateProfiles = pgTable('candidate_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  country: text('country').notNull(),
  city: text('city').notNull(),
  timezone: text('timezone').notNull(),
  workAuthorizations: jsonb('work_authorizations').$type<WorkAuthorization[]>().notNull(),
  willingToRelocate: boolean('willing_to_relocate').notNull(),
  allowedRegions: text('allowed_regions').array().notNull(),
  employmentTypes: text('employment_types').array().$type<CandidateProfileInput['employmentTypes']>().notNull(),
  salaryFloorMinor: integer('salary_floor_minor'),
  salaryCurrency: text('salary_currency').notNull(),
  targetRoles: text('target_roles').array().notNull(),
  seniority: text('seniority').notNull(),
  preferredTech: text('preferred_tech').array().notNull(),
  excludedTech: text('excluded_tech').array().notNull(),
  excludedCompanies: text('excluded_companies').array().notNull(),
  excludedIndustries: text('excluded_industries').array().notNull(),
  spokenLanguages: text('spoken_languages').array().$type<CandidateProfileInput['spokenLanguages']>().notNull().default(sql`'{}'::text[]`),
  constraintModes: jsonb('constraint_modes').$type<ConstraintModes>().notNull(),
}, (t) => [
  check('candidate_profiles_salary_check', sql`${t.salaryFloorMinor} >= 0`),
  check('candidate_profiles_hard_modes_check', sql`(${t.constraintModes}->>'workAuthorizations') is not distinct from 'hard' and (${t.constraintModes}->>'willingToRelocate') is not distinct from 'hard'`),
  tenantIsolation(),
])
