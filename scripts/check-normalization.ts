import { closeDb, getDb } from '@/lib/db/client'
import { checkNormalization } from '@/modules/job-sources'

try {
  const report = await checkNormalization(getDb())
  console.log(`checked: ${report.checked}; failures: ${report.failures.length}`)
  for (const failure of report.failures.slice(0, 20)) console.log(`${failure.sourceId} / ${failure.externalId}: ${failure.message}`)
  if (report.failures.length > 0) process.exitCode = 1
} finally {
  await closeDb()
}
