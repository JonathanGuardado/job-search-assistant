import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Db } from '@/lib/db/client'
import { ok, unwrap } from '@/lib/result'
import { addSource, pollSourcePage, type JobSource, type PagePosting } from '@/modules/job-sources'
import dedupeCasesJson from './__fixtures__/dedupe-cases.json'
import { upsertJobFromRaw } from './service.js'
import type { Job } from './types.js'

/*
 * Jobs are built the way production builds them: a registered board, a poll through a
 * stub fetcher, then normalization of what the poll captured. Nothing here writes
 * job-sources' tables directly.
 */

const PostingSchema = z.looseObject({ id: z.number().int(), title: z.string(), content: z.string() })
export type GreenhousePosting = z.infer<typeof PostingSchema>

const CaseSchema = z.object({ company: z.string(), postings: z.array(PostingSchema).min(2) })
/** Real postings captured 2026-10-21, one group per duplicate-rule case (decision 0008). */
export const dedupeCases = z.object({
  exactRepost: CaseSchema,
  requisitionNumberOnly: CaseSchema,
  differentWorkingHours: CaseSchema,
  seniorAndPrincipal: CaseSchema,
  sameRoleThreeLocations: CaseSchema,
  sameTitleDifferentJobs: CaseSchema,
}).parse(dedupeCasesJson)

let nextId = 9_000_000

export function aPosting(overrides: Partial<GreenhousePosting> = {}): GreenhousePosting {
  const id = nextId++
  return {
    id,
    title: 'Senior Backend Engineer (Remote - LATAM)',
    content: '&lt;p&gt;We hire anywhere in LATAM.&lt;/p&gt;',
    absolute_url: `https://boards.example.com/acme/jobs/${id}`,
    location: { name: 'Remote - LATAM' },
    first_published: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-01T12:00:00Z',
    ...overrides,
  }
}

export async function aBoard(db: Db, name = `Acme ${randomUUID()}`): Promise<JobSource> {
  return unwrap(await addSource(db, { adapterKey: 'greenhouse', name, token: randomUUID() }, async () => Response.json({ name })))
}

/** One complete poll of a Greenhouse board listing exactly `postings`. */
export async function poll(
  db: Db,
  board: JobSource,
  postings: readonly GreenhousePosting[],
  startedAt = new Date(),
): Promise<{ readonly postings: readonly PagePosting[]; readonly fetchedAt: Date }> {
  const outcome = unwrap(await pollSourcePage(
    db,
    { sourceId: board.id, pollId: 'test', cursor: null, startedAt },
    { fetcher: async () => Response.json({ jobs: postings }), enqueueNextPage: async () => ok(undefined) },
  ))
  if (outcome.kind !== 'page') throw new Error('expected an enabled board')
  return outcome
}

/** Polls the board and normalizes everything it captured, in page order. */
export async function storedJobs(db: Db, board: JobSource, postings: readonly GreenhousePosting[]): Promise<Job[]> {
  const page = await poll(db, board, postings)
  const written: Job[] = []
  for (const posting of page.postings) written.push(unwrap(await upsertJobFromRaw(db, posting.rawJobId)))
  return written
}

export async function aStoredJob(db: Db, overrides: Partial<GreenhousePosting> = {}): Promise<Job> {
  const [job] = await storedJobs(db, await aBoard(db), [aPosting(overrides)])
  if (!job) throw new Error('expected one stored job')
  return job
}
