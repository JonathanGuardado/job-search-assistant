import { closeDb, getDb } from '@/lib/db/client'
import { DEV_USER } from '@/lib/dev-user'
import { canApplyJobs, formFetchRequest, openQuestions, readinessForJobs } from '@/modules/application-answers'
import { getApplicationForms, refreshApplicationForm } from '@/modules/job-sources'

/*
 * `pnpm forms:fetch [--refresh]`: fetches the application form of every job the dev user can
 * apply to that has none stored yet (or all of them with --refresh), politely, one at a
 * time, then prints how many are ready to send and the questions blocking the most jobs.
 * No model calls. The worker does the same for jobs that become eligible from now on.
 */

const refresh = process.argv.includes('--refresh')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

try {
  const db = getDb()
  const jobs = await canApplyJobs(db, DEV_USER.id)
  const stored = await getApplicationForms(db, jobs)
  let fetched = 0
  let skipped = 0
  for (const job of jobs) {
    if (!refresh && stored.has(`${job.sourceId}:${job.externalId}`)) continue
    const request = await formFetchRequest(db, job.id)
    if (!request) { skipped++; continue }
    const result = await refreshApplicationForm(db, request.payload, fetch)
    if (result.ok) fetched++
    else { skipped++; console.log(`  skipped ${job.companyName} · ${job.title}: ${result.error.message}`) }
    await sleep(300)
  }
  console.log(`"Can apply" jobs: ${jobs.length}. Forms fetched now: ${fetched}. Skipped: ${skipped}.`)

  const readiness = await readinessForJobs(db, DEV_USER.id, jobs)
  const count = (kind: string, status?: string) => [...readiness.values()].filter((r) => r.kind === kind && (status === undefined || (r.kind === 'assessed' && r.readiness.status === status))).length
  console.log(`Ready to send: ${count('assessed', 'ready')}. Blocked: ${count('assessed', 'blocked')}. No structured form: ${count('unsupported')}. Not fetched: ${count('not_fetched')}.`)
  console.log('\nQuestions blocking the most jobs:')
  for (const q of openQuestions(readiness).slice(0, 20)) {
    console.log(`  ${String(q.jobIds.length).padStart(3)} jobs · ${q.answeredBy.padEnd(12)} · ${q.label.slice(0, 110)}`)
  }
} finally {
  await closeDb()
}
