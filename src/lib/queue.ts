import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import type { z } from 'zod'
import type { DomainError, DomainErrorCode, Result } from './result.js'

/**
 * Typed BullMQ queues. A queue is defined once, next to the module that owns
 * its handler, and opened by producers and by the worker entrypoint.
 *
 * Every job carries a caller-chosen key used as the BullMQ job id, so enqueuing
 * the same logical work twice is a no-op. Handlers must be idempotent anyway:
 * a job can run more than once after a crash between commit and ack.
 */

// Retrying cannot fix these; failing fast keeps them out of the backoff loop.
const PERMANENT_FAILURES: ReadonlySet<DomainErrorCode> = new Set(['not_found', 'invalid_input'])

/** How long a worker pauses after a provider quota error, unless overridden. */
const RATE_LIMIT_PAUSE_MS = 60_000

export type QueueConnectionOptions = {
  readonly connection: Redis
  /** Namespaces keys; tests use a unique prefix per run. */
  readonly prefix?: string
  readonly attempts?: number
  readonly backoffMs?: number
  readonly rateLimitPauseMs?: number
}

/** BullMQ requires `maxRetriesPerRequest: null` on connections used by workers. */
export function connectRedis(url: string, mode: 'worker' | 'producer' = 'worker'): Redis {
  return new Redis(url, mode === 'worker'
    ? { maxRetriesPerRequest: null }
    : { maxRetriesPerRequest: 1, connectTimeout: 5_000, retryStrategy: () => null })
}

export function defineQueue<S extends z.ZodType>(name: string, payloadSchema: S) {
  type Payload = z.output<S>

  return {
    name,

    open(options: QueueConnectionOptions) {
      const queue = new Queue(name, {
        connection: options.connection,
        ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
        defaultJobOptions: {
          attempts: options.attempts ?? 3,
          backoff: { type: 'exponential', delay: options.backoffMs ?? 1_000 },
          // Completed jobs are kept a day so a duplicate key within that window is still dropped.
          removeOnComplete: { age: 24 * 3600 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      })
      return {
        queue,
        /** BullMQ reserves ':' in job ids, so keys must avoid it. */
        enqueue: (payload: Payload, key: string): Promise<Job> =>
          queue.add(name, payload, { jobId: key }),
        close: () => queue.close(),
      }
    },

    /** The processor is an edge: it turns error results into throws so BullMQ records and retries them. */
    work(
      options: QueueConnectionOptions & { readonly concurrency?: number },
      handler: (payload: Payload) => Promise<Result<unknown, DomainError>>,
    ): Worker {
      const worker: Worker = new Worker(
        name,
        async (job) => {
          const parsed = payloadSchema.safeParse(job.data)
          if (!parsed.success) {
            throw new UnrecoverableError(`${name}: invalid payload: ${parsed.error.message}`)
          }
          const result = await handler(parsed.data)
          if (result.ok) return
          if (result.error.code === 'rate_limited') {
            // Pause this worker and put the job back without spending one of its attempts.
            await worker.rateLimit(options.rateLimitPauseMs ?? RATE_LIMIT_PAUSE_MS)
            throw Worker.RateLimitError()
          }
          const message = `${name}: ${result.error.code}: ${result.error.message}`
          throw PERMANENT_FAILURES.has(result.error.code)
            ? new UnrecoverableError(message)
            : new Error(message)
        },
        {
          connection: options.connection,
          concurrency: options.concurrency ?? 1,
          ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
        },
      )
      return worker
    },
  }
}
