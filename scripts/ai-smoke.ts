import { z } from 'zod'
import { callModel, type TaskDefinition } from '@/modules/ai'

/**
 * `pnpm ai:smoke`: one real, cheap model call to prove the provider wiring.
 * Costs real money, so it is not part of `pnpm test`. The task below is a
 * throwaway, not a product task.
 */

const task: TaskDefinition<{ text: string }> = {
  name: 'smoke.country',
  version: 1,
  tier: 'extraction',
  system: 'Extract the single country a job posting restricts hiring to.',
  render: ({ text }) => `Posting:\n${text}\n\nReturn the ISO 3166-1 alpha-2 code.`,
  maxTokens: 256,
}

const result = await callModel({
  task,
  schema: z.object({ country: z.string().length(2) }),
  input: { text: 'Senior engineer, remote — candidates must be based in Mexico.' },
})

console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exitCode = 1
