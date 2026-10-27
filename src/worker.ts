import type { Worker } from 'bullmq'
import { closeDb, getDb } from '@/lib/db/client'
import { getEnv } from '@/lib/env'
import { logEvent } from '@/lib/log'
import { connectRedis } from '@/lib/queue'
import {
  answerDraftQueue, draftAnswers, formFetchRequest, matchQuestionsWithModel, questionMatchQueue, readQuestionsWithModel, refreshQuestionMatches,
} from '@/modules/application-answers'
import { resumeParseQueue, runResumeParse } from '@/modules/career-knowledge'
import {
  assessEligibilityQueue, assessJobForUser, enqueueAssessmentsForJob, enqueueAssessmentsForUser, extractClaimsWithModel, reassessUserQueue,
} from '@/modules/eligibility'
import { closeUnseenJobs, jobNormalizeKey, jobNormalizeQueue, recordSightings, upsertJobFromRaw } from '@/modules/jobs'
import {
  assessMatchForUser, assessMatchQueue, enqueueMatch, enqueueMatchesForUser, extractRequirementsWithModel, rematchUserQueue,
} from '@/modules/matching'
import {
  applicationFormFetchQueue, DISPATCH_EVERY_MS, dispatchSourcePolls, pollSourcePage, refreshApplicationForm, sourcePollDispatchQueue, sourcePollKey,
  sourcePollQueue, type SourcePollPayload,
} from '@/modules/job-sources'
import { domainError, err, ok, type Result } from '@/lib/result'

/**
 * `pnpm worker`: the background-job process. An edge — failures here throw and
 * are recorded by BullMQ; domain code below it returns results.
 */

const connection = connectRedis(getEnv().REDIS_URL)
const db = getDb()
const pollProducer = sourcePollQueue.open({ connection })
const dispatchProducer = sourcePollDispatchQueue.open({ connection })
const normalizeProducer = jobNormalizeQueue.open({ connection })
const assessProducer = assessEligibilityQueue.open({ connection })
const enqueueAssessment = async (payload: { userId: string; jobId: string }, key: string) => { await assessProducer.enqueue(payload, key) }
const matchProducer = assessMatchQueue.open({ connection })
const rematchProducer = rematchUserQueue.open({ connection })
const enqueueMatchJob = async (payload: { userId: string; jobId: string }, key: string) => { await matchProducer.enqueue(payload, key) }
const formProducer = applicationFormFetchQueue.open({ connection })

/** A normalized job is assessed for every candidate, unless it is closed or a linked duplicate. */
async function normalizeJob(rawJobId: string): Promise<Result<void>> {
  const job = await upsertJobFromRaw(db, rawJobId)
  if (!job.ok) return job
  if (job.value.closedAt !== null || job.value.canonicalJobId !== null) return ok(undefined)
  try {
    await enqueueAssessmentsForJob(db, job.value, enqueueAssessment)
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'Could not queue eligibility assessments.'))
  }
}

/** Eligibility first; a job it does not reject is then queued for matching. */
async function assessJob(payload: { userId: string; jobId: string }): Promise<Result<void>> {
  const outcome = await assessJobForUser(db, payload, extractClaimsWithModel)
  if (!outcome.ok) return outcome
  const { value } = outcome
  // A fresh verdict may still need a match: the candidate's record can change without eligibility's inputs changing.
  if (value.kind === 'skipped' || (value.kind === 'assessed' && value.verdict === 'not_eligible')) return ok(undefined)
  try {
    await enqueueMatch(db, payload, enqueueMatchJob)
    // A job the candidate can apply to needs its application form (decision 0013).
    if (value.kind === 'assessed' && value.verdict === 'eligible') {
      const request = await formFetchRequest(db, payload.jobId)
      if (request) await formProducer.enqueue(request.payload, request.key)
    }
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'Could not queue the match.'))
  }
}

async function rematchUser(userId: string): Promise<Result<void>> {
  try {
    const queued = await enqueueMatchesForUser(db, userId, enqueueMatchJob)
    logEvent('matching.rematch_queued', { userId, jobs: queued })
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'Could not queue matches.'))
  }
}

/** A finished parse adds draft career items, which matching reads. */
async function parseResume(payload: { userId: string; resumeId: string }): Promise<Result<void>> {
  const parsed = await runResumeParse(db, payload)
  if (!parsed.ok) return parsed
  try {
    await rematchProducer.enqueue({ userId: payload.userId }, `${payload.userId}@parse@${payload.resumeId}`)
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'Could not queue matches after the parse.'))
  }
}

async function reassessUser(userId: string): Promise<Result<void>> {
  try {
    const queued = await enqueueAssessmentsForUser(db, userId, enqueueAssessment)
    logEvent('eligibility.reassess_queued', { userId, jobs: queued })
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'Could not queue eligibility assessments.'))
  }
}

async function enqueuePoll(payload: SourcePollPayload): Promise<Result<void>> {
  try {
    await pollProducer.enqueue(payload, sourcePollKey(payload))
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'Could not queue the source poll page.'))
  }
}

/**
 * One poll page, end to end. job-sources captures the page; jobs records what was seen,
 * and the postings whose job is missing or stale are queued for normalization. The
 * worker joins the two because job-sources must not depend on jobs (decision 0008).
 * Every step is recomputed from the page, so a retry finishes whatever a failure left.
 */
async function handlePollPage(payload: SourcePollPayload): Promise<Result<void>> {
  const polled = await pollSourcePage(db, payload, { fetcher: fetch, enqueueNextPage: enqueuePoll })
  if (!polled.ok) return polled
  if (polled.value.kind === 'disabled') return ok(undefined)
  const page = polled.value
  const { rawJobIdsToNormalize } = await recordSightings(db, { sourceId: page.sourceId, postings: page.postings, seenAt: page.fetchedAt })
  try {
    for (const rawJobId of rawJobIdsToNormalize) await normalizeProducer.enqueue({ rawJobId }, jobNormalizeKey(rawJobId))
  } catch {
    return err(domainError('upstream_failed', 'Could not queue job normalization.'))
  }
  if (page.isFinalPage) {
    const closing = await closeUnseenJobs(db, { sourceId: page.sourceId, pollStartedAt: payload.startedAt })
    if (closing.skipped) logEvent('jobs.close_skipped', { sourceId: page.sourceId, reason: 'poll listed none of the source jobs' })
  }
  return ok(undefined)
}

const workers: Worker[] = [
  resumeParseQueue.work({ connection }, parseResume),
  sourcePollQueue.work({ connection, concurrency: 1 }, handlePollPage),
  // Concurrency 1: linking reads and rewrites a fingerprint's cluster, so two normalizations
  // of one cluster must not interleave.
  jobNormalizeQueue.work({ connection, concurrency: 1 }, ({ rawJobId }) => normalizeJob(rawJobId)),
  // One at a time: a provider quota error pauses this worker (lib/queue) until the quota resets.
  assessEligibilityQueue.work({ connection, concurrency: 1 }, assessJob),
  reassessUserQueue.work({ connection }, ({ userId }) => reassessUser(userId)),
  // One at a time, like eligibility: both share the provider's quota.
  assessMatchQueue.work({ connection, concurrency: 1 }, async (payload) => {
    const outcome = await assessMatchForUser(db, payload, extractRequirementsWithModel)
    return outcome.ok ? ok(undefined) : outcome
  }),
  rematchUserQueue.work({ connection }, ({ userId }) => rematchUser(userId)),
  // One at a time: a public API shared by every board, polled politely.
  applicationFormFetchQueue.work({ connection, concurrency: 1 }, async (posting) => {
    const fetched = await refreshApplicationForm(db, posting, fetch)
    // A posting that is gone, or a form that cannot be read, is not worth retrying.
    if (!fetched.ok && (fetched.error.code === 'not_found' || fetched.error.code === 'invalid_input')) {
      logEvent('application_form.skipped', { ...posting, reason: fetched.error.message })
      return ok(undefined)
    }
    return fetched.ok ? ok(undefined) : fetched
  }),
  // One at a time, like the other model queues: they share the provider's quota.
  questionMatchQueue.work({ connection, concurrency: 1 }, async ({ userId }) => {
    const matched = await refreshQuestionMatches(db, userId, matchQuestionsWithModel)
    return matched.ok ? ok(undefined) : matched
  }),
  answerDraftQueue.work({ connection, concurrency: 1 }, async ({ userId }) => {
    const drafted = await draftAnswers(db, userId, readQuestionsWithModel)
    if (drafted.ok) logEvent('application_answers.drafted', { userId, ...drafted.value })
    return drafted.ok ? ok(undefined) : drafted
  }),
  sourcePollDispatchQueue.work({ connection }, () => dispatchSourcePolls(db, new Date(), enqueuePoll)),
]

for (const worker of workers) {
  worker.on('completed', (job) =>
    logEvent('queue.job_completed', { queue: worker.name, jobId: job.id, attempts: job.attemptsMade }),
  )
  worker.on('failed', (job, error) =>
    logEvent('queue.job_failed', {
      queue: worker.name,
      jobId: job?.id,
      attempts: job?.attemptsMade,
      error: error.message,
    }),
  )
}

await dispatchProducer.queue.upsertJobScheduler('source-poll-dispatch', { every: DISPATCH_EVERY_MS }, { name: 'source-poll-dispatch', data: {} })

logEvent('worker.started', { queues: workers.map((w) => w.name) })

async function shutdown(signal: string): Promise<void> {
  logEvent('worker.stopping', { signal })
  // Closing waits for in-flight jobs, so nothing is abandoned mid-write.
  await Promise.all(workers.map((w) => w.close()))
  await Promise.all([
    pollProducer.close(), dispatchProducer.close(), normalizeProducer.close(), assessProducer.close(), matchProducer.close(), rematchProducer.close(),
    formProducer.close(),
  ])
  await connection.quit()
  await closeDb()
  process.exit(0)
}

process.once('SIGINT', (signal) => void shutdown(signal))
process.once('SIGTERM', (signal) => void shutdown(signal))
