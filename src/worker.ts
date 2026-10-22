import type { Worker } from 'bullmq'
import { closeDb, getDb } from '@/lib/db/client'
import { getEnv } from '@/lib/env'
import { logEvent } from '@/lib/log'
import { connectRedis } from '@/lib/queue'
import { resumeParseQueue, runResumeParse } from '@/modules/career-knowledge'
import { closeUnseenJobs, jobNormalizeKey, jobNormalizeQueue, recordSightings, upsertJobFromRaw } from '@/modules/jobs'
import {
  DISPATCH_EVERY_MS, dispatchSourcePolls, pollSourcePage, sourcePollDispatchQueue, sourcePollKey, sourcePollQueue, type SourcePollPayload,
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
  resumeParseQueue.work({ connection }, (payload) => runResumeParse(db, payload)),
  sourcePollQueue.work({ connection, concurrency: 1 }, handlePollPage),
  // Concurrency 1: linking reads and rewrites a fingerprint's cluster, so two normalizations
  // of one cluster must not interleave.
  jobNormalizeQueue.work({ connection, concurrency: 1 }, ({ rawJobId }) => upsertJobFromRaw(db, rawJobId)),
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
  await Promise.all([pollProducer.close(), dispatchProducer.close(), normalizeProducer.close()])
  await connection.quit()
  await closeDb()
  process.exit(0)
}

process.once('SIGINT', (signal) => void shutdown(signal))
process.once('SIGTERM', (signal) => void shutdown(signal))
