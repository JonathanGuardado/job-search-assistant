import { z } from 'zod'

export const NewUserSchema = z.object({
  id: z.uuid().optional(),
  email: z.email(),
})
export type NewUser = z.infer<typeof NewUserSchema>

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  createdAt: z.date(),
})
export type User = z.infer<typeof UserSchema>
