import { closeDb, getDb } from '@/lib/db/client'
import { rereadApplicationForms } from '@/modules/job-sources'

/*
 * `pnpm forms:reread`: reads every stored application form again from its kept payload, with
 * no fetching, after the parser learns to read more of it (decision 0016). A form that can no
 * longer be read is removed and fetched again by the worker. No model calls.
 */

try {
  const { reread, removed } = await rereadApplicationForms(getDb())
  console.log(`Forms re-read: ${reread}. Removed as unreadable: ${removed.length}.`)
  for (const posting of removed) console.log(`  removed ${posting.sourceId}:${posting.externalId}`)
} finally {
  await closeDb()
}
