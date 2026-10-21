import { z } from 'zod'
import { closeDb, getDb } from '@/lib/db/client'
import { addSource, NewSourceSchema } from '@/modules/job-sources'
// The starter boards approved for M1.4. Script data, so it lives beside the script, not in the module.
import seedSources from './seed-sources.json'

const entries = z.array(NewSourceSchema).parse(seedSources)
try {
  for (const entry of entries) {
    const result = await addSource(getDb(), entry, fetch)
    const status = result.ok ? 'added' : result.error.code === 'conflict' ? 'exists' : `failed: ${result.error.message}`
    console.log(`${entry.name}: ${status}`)
    if (!result.ok && result.error.code !== 'conflict') process.exitCode = 1
  }
} finally {
  await closeDb()
}
