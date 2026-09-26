import { defineQueue } from '@/lib/queue'
import { JobSeenPayloadSchema } from './types.js'

/**
 * Records that a posting was observed again. Adapters (M1.4) enqueue it on
 * every repoll; the handler is markJobSeen. Key: `${jobId}@${seenAt epoch ms}`.
 */
export const jobSeenQueue = defineQueue('job-seen', JobSeenPayloadSchema)
