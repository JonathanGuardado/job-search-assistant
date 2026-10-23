import { closeDb, getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { assessJobForUser, extractClaimsWithModel, listJobIdsNotRejected } from '@/modules/eligibility'
import { getJob } from '@/modules/jobs'
import { assessMatchForUser, extractRequirementsWithModel, getMatchCard, type CardSection } from '@/modules/matching'

/*
 * `pnpm match:explain [jobId ...]`: prints job cards as the dev user would see them, so
 * the explanations can be judged before the jobs UI (1.8) exists. With job ids, each job is
 * assessed first if needed (eligibility, then matching: up to two model calls per job, each
 * reused afterwards). With none, it prints up to `--limit=10` jobs eligibility did not
 * reject, matching any that have not been matched yet.
 */

const MARK: Record<CardSection['status'], string> = { meets: '✓', partial: '~', gap: '✗', unknown: '?', not_stated: '·' }

const args = process.argv.slice(2)
const limit = Number(args.find((arg) => arg.startsWith('--limit='))?.slice('--limit='.length) ?? 10)
const requested = args.filter((arg) => !arg.startsWith('--'))

async function show(jobId: string): Promise<void> {
  const db = getDb()
  const job = await getJob(db, jobId)
  if (!job.ok) return console.log(`${jobId}: ${job.error.message}\n`)
  const eligibility = await assessJobForUser(db, { userId: DEV_USER.id, jobId }, extractClaimsWithModel)
  if (!eligibility.ok) return console.log(`${jobId}: eligibility failed (${eligibility.error.message})\n`)
  const match = await assessMatchForUser(db, { userId: DEV_USER.id, jobId }, extractRequirementsWithModel)
  if (!match.ok) return console.log(`${jobId}: matching failed (${match.error.message})\n`)

  console.log(`━━ ${job.value.companyName} · ${job.value.title} · ${job.value.locationText ?? 'no location'}`)
  console.log(`   ${job.value.applyUrl}`)
  if (match.value.kind === 'skipped') return console.log(`   Not matched: ${match.value.reason.replaceAll('_', ' ')}\n`)
  const card = await getMatchCard(db, DEV_USER.id, jobId)
  if (!card) return console.log('   Not matched yet.\n')
  if (card.match.concerns.length > 0) {
    console.log('   Before you apply:')
    for (const concern of card.match.concerns) console.log(`     • ${concern}`)
  }
  for (const section of card.sections) {
    console.log(`   ${MARK[section.status]} ${section.headline}`)
    for (const detail of section.details) console.log(`       ${detail}`)
  }
  console.log()
}

try {
  const jobIds = requested.length > 0 ? requested : (await withTenant(getDb(), DEV_USER.id, listJobIdsNotRejected)).slice(0, limit)
  if (jobIds.length === 0) console.log('No jobs to show: eligibility has not assessed any job for the dev user yet, or rejected them all.')
  for (const jobId of jobIds) await show(jobId)
} finally {
  await closeDb()
}
