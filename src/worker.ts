import type { Worker } from 'bullmq'
import { closeDb, getDb } from '@/lib/db/client'
import { getEnv } from '@/lib/env'
import { logEvent } from '@/lib/log'
import { connectRedis } from '@/lib/queue'
import { resumeParseQueue, runResumeParse } from '@/modules/career-knowledge'
import { jobSeenQueue, markJobSeen } from '@/modules/jobs'

/**
 * `pnpm worker`: the background-job process. An edge — failures here throw and
 * are recorded by BullMQ; domain code below it returns results.
 */

const connection = connectRedis(getEnv().REDIS_URL)
const db = getDb()

const workers: Worker[] = [
  jobSeenQueue.work({ connection }, (payload) => markJobSeen(db, payload)),
  resumeParseQueue.work({ connection }, (payload) => runResumeParse(db, payload)),
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

logEvent('worker.started', { queues: workers.map((w) => w.name) })

async function shutdown(signal: string): Promise<void> {
  logEvent('worker.stopping', { signal })
  // Closing waits for in-flight jobs, so nothing is abandoned mid-write.
  await Promise.all(workers.map((w) => w.close()))
  await connection.quit()
  await closeDb()
  process.exit(0)
}

process.once('SIGINT', (signal) => void shutdown(signal))
process.once('SIGTERM', (signal) => void shutdown(signal))
