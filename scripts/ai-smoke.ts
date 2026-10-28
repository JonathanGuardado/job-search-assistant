import { z } from 'zod'
import { callModel, MODEL_ROLES, modelNameOf, type TaskDefinition } from '@/modules/ai'

/**
 * `pnpm ai:smoke`: one real, cheap call per configured model (primary and secondary), to
 * prove each one's provider, model and key in .env.local. Costs real money, so it is not part
 * of `pnpm test`. The task below is a throwaway, not a product task.
 */

for (const role of MODEL_ROLES) {
  const task: TaskDefinition<{ text: string }> = {
    name: 'smoke.country',
    version: 1,
    role,
    system: 'Extract the single country a job posting restricts hiring to.',
    render: ({ text }) => `Posting:\n${text}\n\nReturn the ISO 3166-1 alpha-2 code.`,
    maxTokens: 256,
  }
  const label = `${role} (${modelNameOf(role) ?? 'not configured'})`
  try {
    const result = await callModel({
      task,
      schema: z.object({ country: z.string().length(2) }),
      input: { text: 'Senior engineer, remote — candidates must be based in Mexico.' },
    })
    console.log(`${label}:`, result.ok ? result.value.value : result.error.message)
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    // Missing settings are a configuration error, thrown before any request.
    console.log(`${label}:`, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
