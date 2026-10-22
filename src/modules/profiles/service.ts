import type { Db } from '@/lib/db/client'
import { eq } from 'drizzle-orm'
import type { TenantScope } from '@/lib/db/tenancy'
import { domainError, err, ok, type Result } from '@/lib/result'
import { candidateProfiles, users } from './schema.js'
import { CandidateProfileSchema, type CandidateProfile, type CandidateProfileInput, type NewUser, type User } from './types.js'

/** Idempotent on email, so re-running the dev seed is harmless. */
export async function ensureUser(db: Db, input: NewUser): Promise<User> {
  const [row] = await db
    .insert(users)
    .values(input)
    .onConflictDoUpdate({ target: users.email, set: { email: input.email } })
    .returning()
  if (!row) throw new Error('insert ... returning produced no row')
  return row
}

/** Every tenant, for fan-out jobs that enqueue one tenant-scoped job per user. */
export async function listUserIds(db: Db): Promise<string[]> {
  return (await db.select({ id: users.id }).from(users)).map((row) => row.id)
}

export async function getCandidateProfile(scope: TenantScope): Promise<CandidateProfile | null> {
  const [row] = await scope.db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, scope.userId))
  return row ? CandidateProfileSchema.parse(row) : null
}

export async function saveCandidateProfile(scope: TenantScope, input: CandidateProfileInput): Promise<Result<CandidateProfile>> {
  const [row] = await scope.db.insert(candidateProfiles).values({ ...input, userId: scope.userId })
    .onConflictDoUpdate({ target: candidateProfiles.userId, set: input }).returning()
  return row ? ok(CandidateProfileSchema.parse(row)) : err(domainError('conflict', 'The profile could not be saved.'))
}
