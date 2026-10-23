import { closeDb, getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { assessJobForUser, effectiveVerdict, extractClaimsWithModel, getAssessment } from '@/modules/eligibility'
import { getJob } from '@/modules/jobs'
import { assessMatchForUser, compareForReview, extractRequirementsWithModel, getMatchCard, listMatches, REVIEW_ORDER, type CardSection, type DimensionStatus } from '@/modules/matching'

/*
 * `pnpm match:explain [jobId ...]`: prints job cards as the dev user would see them, so
 * the explanations can be judged before the jobs UI (1.8) exists.
 *
 * With job ids, each job is assessed first if needed (eligibility, then matching: up to two
 * model calls per job, each reused afterwards). With none, it reads the matches the worker
 * stored (no model calls) and prints `--limit=10` of them, ordered as the header says.
 */

const MARK: Record<CardSection['status'], string> = { meets: '✓', partial: '~', gap: '✗', unknown: '?', not_stated: '·' }

const args = process.argv.slice(2)
const limit = Number(args.find((arg) => arg.startsWith('--limit='))?.slice('--limit='.length) ?? 10)
const requested = args.filter((arg) => !arg.startsWith('--'))

async function show(jobId: string, assess: boolean): Promise<void> {
  const db = getDb()
  const job = await getJob(db, jobId)
  if (!job.ok) return console.log(`${jobId}: ${job.error.message}\n`)
  if (assess) {
    const eligibility = await assessJobForUser(db, { userId: DEV_USER.id, jobId }, extractClaimsWithModel)
    if (!eligibility.ok) return console.log(`${jobId}: eligibility failed (${eligibility.error.message})\n`)
    const match = await assessMatchForUser(db, { userId: DEV_USER.id, jobId }, extractRequirementsWithModel)
    if (!match.ok) return console.log(`${jobId}: matching failed (${match.error.message})\n`)
    if (match.value.kind === 'skipped') return console.log(`━━ ${job.value.companyName} · ${job.value.title}\n   Not matched: ${match.value.reason.replaceAll('_', ' ')}\n`)
  }
  const card = await getMatchCard(db, DEV_USER.id, jobId)
  const eligibility = await withTenant(db, DEV_USER.id, (scope) => getAssessment(scope, jobId))
  console.log(`━━ ${job.value.companyName} · ${job.value.title} · ${job.value.locationText ?? 'no location'}`)
  console.log(`   ${job.value.applyUrl}`)
  // Eligibility first: a card full of checks says nothing if the candidate cannot take the job.
  if (eligibility) {
    const verdict = effectiveVerdict(eligibility)
    const why = 'openQuestions' in eligibility.reasons ? eligibility.reasons.openQuestions.join(' / ') : 'reason' in eligibility.reasons ? eligibility.reasons.reason : ''
    console.log(`   Eligibility: ${verdict === 'eligible' ? 'you can take this job' : verdict === 'needs_review' ? 'needs review' : 'not eligible'}${why ? ` — ${why}` : ''}`)
  }
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
  if (requested.length > 0) {
    for (const jobId of requested) await show(jobId, true)
  } else {
    const matches = (await withTenant(getDb(), DEV_USER.id, listMatches)).sort(compareForReview)
    const count = (status: DimensionStatus) => matches.filter((m) => m.dimensions.role.status === status).length
    console.log(`${matches.length} matched jobs: ${count('meets')} match a target role, ${count('partial')} are close, ${count('gap')} are other roles.`)
    console.log(`Showing ${Math.min(limit, matches.length)}. ${REVIEW_ORDER}\n`)
    for (const match of matches.slice(0, limit)) await show(match.jobId, false)
  }
} finally {
  await closeDb()
}
