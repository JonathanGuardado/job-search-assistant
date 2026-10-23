import { randomUUID } from 'node:crypto'
import type { Db } from '@/lib/db/client'
import { ok, unwrap } from '@/lib/result'
import { addSource, pollSourcePage, type JobSource } from '@/modules/job-sources'
import { closeUnseenJobs, recordSightings, upsertJobFromRaw, type Job } from '@/modules/jobs'
import { ensureUser } from '@/modules/profiles'

/*
 * Jobs and candidates built through each module's public interface: a polled Greenhouse
 * board normalized into jobs. Nothing here writes another module's tables directly.
 */

let nextPostingId = 9_000_000

export type Posting = { readonly id: number; readonly title: string; readonly content: string }

export const aPosting = (overrides: Partial<Posting> = {}): Posting => ({
  id: nextPostingId++,
  title: 'Senior Backend Engineer',
  content: '&lt;p&gt;Remote across LATAM. You have 5+ years with TypeScript.&lt;/p&gt;',
  ...overrides,
})

export async function aBoard(db: Db): Promise<JobSource> {
  return unwrap(await addSource(db, { adapterKey: 'greenhouse', name: `Initech ${randomUUID()}`, token: randomUUID() }, async () => Response.json({ name: 'Initech' })))
}

/** Polls the board listing exactly these postings, normalizes them, and returns their jobs. */
export async function publish(db: Db, board: JobSource, postings: readonly Posting[], startedAt = new Date()): Promise<Job[]> {
  const payloads = postings.map((posting) => ({
    id: posting.id, title: posting.title, content: posting.content, location: { name: 'Remote - LATAM' },
    absolute_url: `https://boards.example.com/initech/jobs/${posting.id}`, first_published: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
  }))
  const page = unwrap(await pollSourcePage(
    db,
    { sourceId: board.id, pollId: randomUUID(), cursor: null, startedAt },
    { fetcher: async () => Response.json({ jobs: payloads }), enqueueNextPage: async () => ok(undefined) },
  ))
  if (page.kind !== 'page') throw new Error('expected a captured page')
  const jobs: Job[] = []
  for (const posting of page.postings) jobs.push(unwrap(await upsertJobFromRaw(db, posting.rawJobId)))
  // As the worker does after each page: what the poll listed counts as seen at its start.
  await recordSightings(db, { sourceId: board.id, postings: page.postings, seenAt: startedAt })
  return jobs
}

export async function aJob(db: Db, posting: Posting = aPosting()): Promise<{ readonly board: JobSource; readonly job: Job }> {
  const board = await aBoard(db)
  const [job] = await publish(db, board, [posting])
  if (!job) throw new Error('expected one job')
  return { board, job }
}

/** The posting goes offline: the board's next complete poll no longer lists it, so the job closes. */
export async function takeDown(db: Db, board: JobSource, other: Posting = aPosting()): Promise<void> {
  const startedAt = new Date(Date.now() + 1000)
  await publish(db, board, [other], startedAt)
  await closeUnseenJobs(db, { sourceId: board.id, pollStartedAt: startedAt })
}

export async function aCandidate(db: Db): Promise<string> {
  return (await ensureUser(db, { email: `applicant-${randomUUID()}@test.local` })).id
}
