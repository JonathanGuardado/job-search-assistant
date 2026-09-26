import type { Db } from '@/lib/db/client'
import { users } from './schema.js'
import type { NewUser, User } from './types.js'

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
