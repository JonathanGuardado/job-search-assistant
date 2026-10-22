import { closeDb, getDb } from '@/lib/db/client'
import { listLatestRawJobIds } from '@/modules/job-sources'
import { upsertJobFromRaw } from '@/modules/jobs'

/*
 * `pnpm jobs:renormalize`: rebuilds every job from the newest stored version of its
 * posting, the replay that keeping raw data exists for. Idempotent. Stop `pnpm worker`
 * first: normalization relinks duplicate clusters and must not interleave with it.
 */

try {
  const rawJobIds = await listLatestRawJobIds(getDb())
  const failures: string[] = []
  for (const rawJobId of rawJobIds) {
    const written = await upsertJobFromRaw(getDb(), rawJobId)
    if (!written.ok) failures.push(`${rawJobId}: ${written.error.message}`)
  }
  console.log(`normalized: ${rawJobIds.length - failures.length}; failed: ${failures.length}`)
  for (const failure of failures.slice(0, 20)) console.log(failure)
  if (failures.length > 0) process.exitCode = 1
} finally {
  await closeDb()
}
