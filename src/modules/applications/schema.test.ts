import { eq, sql } from 'drizzle-orm'
import { describe, expect } from 'vitest'
import { withTenant } from '@/lib/db/tenancy'
import { dbErrorFrom, dbTest as test } from '@/lib/db/testing'
import { unwrap } from '@/lib/result'
import { getJob, getJobRawVersion } from '@/modules/jobs'
import { applicationEvents, applications } from './schema.js'
import { aCandidate, aJob, takeDown } from './test-fixtures.js'

/*
 * What the database itself guarantees about applications (decision 0012), independent of
 * any service code: history cannot be rewritten, applications cannot be deleted, a salary
 * carries its currency, and one candidate's history cannot attach to another's application.
 */

async function anApplication(db: Parameters<typeof aJob>[0]) {
  const { board, job } = await aJob(db)
  const userId = await aCandidate(db)
  const rawJobId = unwrap(await getJobRawVersion(db, job.id))
  const application = await withTenant(db, userId, async (scope) => {
    const [row] = await scope.db.insert(applications).values({
      userId, jobId: job.id, rawJobId, status: 'applied', appliedOn: '2026-10-20', sourceUrl: job.applyUrl,
    }).returning()
    if (!row) throw new Error('expected an application')
    await scope.db.insert(applicationEvents).values({ userId, applicationId: row.id, fromStatus: null, toStatus: 'applied', occurredOn: '2026-10-20' })
    return row
  })
  return { board, job, userId, application }
}

describe('applications in the database', () => {
  test('history is append-only: an event cannot be edited or deleted', async ({ db }) => {
    const { userId, application } = await anApplication(db)
    await withTenant(db, userId, async (scope) => {
      expect(await dbErrorFrom(scope.db, (d) => d.update(applicationEvents).set({ note: 'rewritten' }).where(eq(applicationEvents.applicationId, application.id))))
        .toContain('permission denied')
      expect(await dbErrorFrom(scope.db, (d) => d.delete(applicationEvents).where(eq(applicationEvents.applicationId, application.id))))
        .toContain('permission denied')
    })
  })

  test('an application cannot be deleted, but its status can change', async ({ db }) => {
    const { userId, application } = await anApplication(db)
    await withTenant(db, userId, async (scope) => {
      expect(await dbErrorFrom(scope.db, (d) => d.delete(applications).where(eq(applications.id, application.id)))).toContain('permission denied')
      await scope.db.update(applications).set({ status: 'interviewing' }).where(eq(applications.id, application.id))
    })
  })

  test('a salary asked carries its currency, and an event must change the status', async ({ db }) => {
    const { userId, application } = await anApplication(db)
    await withTenant(db, userId, async (scope) => {
      expect(await dbErrorFrom(scope.db, (d) => d.update(applications).set({ salaryAskedMinor: 9_000_000 }).where(eq(applications.id, application.id))))
        .toContain('applications_salary_check')
      expect(await dbErrorFrom(scope.db, (d) => d.insert(applicationEvents).values({ userId, applicationId: application.id, fromStatus: 'applied', toStatus: 'applied', occurredOn: '2026-10-21' })))
        .toContain('application_events_change_check')
    })
  })

  test('one application per job, and history cannot attach to another candidate\'s application', async ({ db }) => {
    const { job, userId, application } = await anApplication(db)
    const intruder = await aCandidate(db)
    await withTenant(db, userId, async (scope) => {
      expect(await dbErrorFrom(scope.db, (d) => d.insert(applications).values({
        userId, jobId: job.id, rawJobId: application.rawJobId, status: 'applied', appliedOn: '2026-10-21', sourceUrl: job.applyUrl,
      }))).toContain('applications_user_job_key')
    })
    await withTenant(db, intruder, async (scope) => {
      expect(await dbErrorFrom(scope.db, (d) => d.insert(applicationEvents).values({ userId: intruder, applicationId: application.id, fromStatus: 'applied', toStatus: 'rejected', occurredOn: '2026-10-21' })))
        .toContain('application_events_application_fk')
      expect(await scope.db.select().from(applications)).toEqual([])
    })
  })

  test('the posting version applied to outlives the posting going offline', async ({ db }) => {
    const { board, job, application } = await anApplication(db)
    await takeDown(db, board)
    expect(unwrap(await getJob(db, job.id)).closedAt).not.toBeNull()
    const [raw] = await db.execute<{ id: string }>(sql`select id from raw_jobs where id = ${application.rawJobId}`)
    expect(raw?.id).toBe(application.rawJobId)
  })
})
