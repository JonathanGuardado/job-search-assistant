import { defineQueue } from '@/lib/queue'
import { JobNormalizePayloadSchema } from './types.js'

/**
 * Normalizes one stored raw version into its job (handler: upsertJobFromRaw). Enqueued
 * by the worker for each posting a poll page reports as missing or out of date. Keyed
 * by raw version, so a posting that is re-requested before it runs is queued once.
 */
export const jobNormalizeQueue = defineQueue('job-normalize', JobNormalizePayloadSchema)

export const jobNormalizeKey = (rawJobId: string): string => rawJobId
