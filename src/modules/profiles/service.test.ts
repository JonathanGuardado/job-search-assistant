import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { describe, expect } from 'vitest'
import { withTenant } from '@/lib/db/tenancy'
import { dbErrorFrom, dbTest as test } from '@/lib/db/testing'
import { unwrap } from '@/lib/result'
import { candidateProfiles } from './schema.js'
import { ensureUser, getCandidateProfile, saveCandidateProfile } from './service.js'
import { profileFixture } from './test-fixtures.js'

const email = () => `profile-${randomUUID()}@test.local`

describe('candidate profiles', () => {
  test('round-trips all fields and every independently configurable constraint', async ({ db }) => {
    const user = await ensureUser(db, { email: email() })
    await withTenant(db, user.id, async (scope) => {
      expect(await getCandidateProfile(scope)).toBeNull()
      const saved = unwrap(await saveCandidateProfile(scope, profileFixture))
      expect(saved).toMatchObject({ ...profileFixture, userId: user.id })
      const constraintModes = { ...profileFixture.constraintModes, country: 'preferred', timezone: 'preferred', salaryFloorMinor: 'preferred' }
      const updated = { ...profileFixture, constraintModes: { ...profileFixture.constraintModes, country: 'preferred' as const, timezone: 'preferred' as const, salaryFloorMinor: 'preferred' as const }, city: 'Updated City' }
      const second = unwrap(await saveCandidateProfile(scope, updated))
      expect(second.id).toBe(saved.id)
      expect((await getCandidateProfile(scope))?.constraintModes).toEqual(constraintModes)
      expect(await getCandidateProfile(scope)).toEqual(second)
    })
  })
  test('isolates reads and writes between tenants', async ({ db }) => {
    const owner = await ensureUser(db, { email: email() })
    const other = await ensureUser(db, { email: email() })
    await withTenant(db, owner.id, (scope) => saveCandidateProfile(scope, profileFixture))
    await withTenant(db, other.id, async (scope) => {
      expect(await getCandidateProfile(scope)).toBeNull()
      unwrap(await saveCandidateProfile(scope, { ...profileFixture, city: 'Other City', salaryFloorMinor: null }))
    })
    expect((await withTenant(db, owner.id, getCandidateProfile))?.city).toBe(profileFixture.city)
    expect((await withTenant(db, other.id, getCandidateProfile))?.salaryFloorMinor).toBeNull()
    const violation = await dbErrorFrom(db, (executor) => withTenant(executor, other.id, (scope) =>
      scope.db.insert(candidateProfiles).values({ ...profileFixture, userId: owner.id }),
    ))
    expect(violation).toContain('row-level security')
  })
  test('database rejects preferred authorization or relocation modes', async ({ db }) => {
    const user = await ensureUser(db, { email: email() })
    await withTenant(db, user.id, (scope) => saveCandidateProfile(scope, profileFixture))
    for (const field of ['workAuthorizations', 'willingToRelocate']) {
      const violation = await dbErrorFrom(db, (executor) => withTenant(executor, user.id, (scope) =>
        scope.db.update(candidateProfiles).set({ constraintModes: sql`${JSON.stringify({ ...profileFixture.constraintModes, [field]: 'preferred' })}::jsonb` }),
      ))
      expect(violation).toContain('candidate_profiles_hard_modes_check')
    }
  })
})
