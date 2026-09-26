import { z } from 'zod'

/**
 * The only place that reads process.env. Everything else imports `env`.
 */

// `KEY=` in a .env file yields '' — treat that as unset, not as a value.
const optionalSecret = z
  .string()
  .transform((value) => (value === '' ? undefined : value))
  .optional()

export const ModelPriceSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative().default(0),
})

const pricingJson = z.string().default('{}').transform((value, ctx): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    ctx.addIssue({ code: 'custom', message: 'AI_MODEL_PRICING must be valid JSON' })
    return z.NEVER
  }
}).pipe(z.record(z.string(), ModelPriceSchema))

export const EnvSchema = z.object({
  DATABASE_URL: z.url(),
  DATABASE_ADMIN_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.url(),
  AI_PROVIDER: z.enum(['deepseek', 'gemini']).default('deepseek'),
  AI_API_KEY: optionalSecret,
  AI_MODEL_PRICING: pricingJson,
  MODEL_EXTRACTION: z.string().min(1),
  MODEL_REASONING: z.string().min(1),
})

export type Env = z.infer<typeof EnvSchema>

export const env: Env = EnvSchema.parse(process.env)
