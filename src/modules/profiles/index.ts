/**
 * Public surface of the profiles module.
 *
 * `users` is exported so other modules' schemas can declare foreign keys to it.
 * Only this module writes to it.
 */
export { users } from './schema.js'
export { ensureUser } from './service.js'
export { NewUserSchema, UserSchema } from './types.js'
export type { NewUser, User } from './types.js'
