import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect } from 'vitest'
import type { Db } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { dbTest as test } from '@/lib/db/testing'
import { ok, unwrap } from '@/lib/result'
import { listApplications } from '@/modules/applications'
import { GITLAB_PAGES, replayContext, type Greenhouse } from './browser-fixtures.js'
import { runFill, type RunnerDeps } from './runner.js'
import { expireFills, prepareFill, startFill, LEASE_MS } from './service.js'
import { anApplicant, changeAnAnswer, type Applicant } from './test-fixtures.js'
import { applicationFills } from './schema.js'
import { eq } from 'drizzle-orm'

/*
 * The worker's run of one fill, end to end: the database, GitLab's recorded page in headless
 * Chromium, and the test playing both Greenhouse and the owner.
 */

let browser: Browser
beforeAll(async () => { browser = await chromium.launch() })
afterAll(async () => { await browser.close() })

/** A started fill for a fresh applicant, and the deps a test run uses. */
async function started(db: Db, greenhouse: Greenhouse, owner: (page: Page, applicant: Applicant) => Promise<void>, overrides: Partial<RunnerDeps> = {}) {
  const applicant = await anApplicant(db)
  const fill = unwrap(await prepareFill(db, applicant.userId, applicant.job.id))
  await withTenant(db, applicant.userId, async (scope) => unwrap(await startFill(scope, fill.id, fill.packetHash)))
  const opened: string[] = []
  const deps: RunnerDeps = {
    worker: 'worker-test', storageRoot: applicant.storageRoot, waitMs: 20_000, pollMs: 100, renewEveryMs: 30_000, lingerMs: 0,
    refreshForm: async () => ok(undefined),
    pages: async () => ok(GITLAB_PAGES),
    openBrowser: async () => {
      opened.push('opened')
      const context = await replayContext(browser, greenhouse)
      return { context, close: () => context.close() }
    },
    owner: (page) => owner(page, applicant),
    ...overrides,
  }
  return { applicant, fill, deps, opened }
}

const fillRow = async (db: Db, applicant: Applicant, fillId: string) =>
  withTenant(db, applicant.userId, async (scope) => (await scope.db.select().from(applicationFills).where(eq(applicationFills.id, fillId)))[0])

const presses = (page: Page) => page.getByRole('button', { name: 'Submit application' }).click()

describe('the worker runs one fill (decision 0016)', { timeout: 90_000 }, () => {
  test('fills the form; the owner submits; it records what was sent, Greenhouse\'s confirmation and the application', async ({ db }) => {
    const { applicant, fill, deps } = await started(db, 'accepts', presses)
    expect(unwrap(await runFill(db, applicant.userId, fill.id, deps))).toBe('submitted')
    const row = await fillRow(db, applicant, fill.id)
    expect(row).toMatchObject({
      status: 'submitted', outcome: 'confirmed', leaseOwner: null,
      submission: { payload: { job_application: { first_name: 'Ana', email: 'ana@example.com' } }, files: [{ name: 'cv.pdf', sha256: applicant.resume.contentSha256 }] },
      outcomeEvidence: { kind: 'confirmation_page' },
    })
    expect(row?.fillReport?.fields.find((f) => f.field === 'first_name')).toMatchObject({ result: 'set' })
    const [application] = await withTenant(db, applicant.userId, listApplications)
    expect(application).toMatchObject({ jobId: applicant.job.id, mode: 'assisted', rawJobId: fill.rawJobId })
    expect(row?.applicationId).toBe(application?.id)
  })

  test('the owner closes the window without submitting: nothing went out, so the fill is abandoned', async ({ db }) => {
    const { applicant, fill, deps } = await started(db, 'accepts', (page) => page.close())
    expect(unwrap(await runFill(db, applicant.userId, fill.id, deps))).toBe('abandoned')
  })

  test('nothing happens before the timeout: abandoned, since nothing went out', async ({ db }) => {
    const { applicant, fill, deps } = await started(db, 'accepts', async () => {}, { waitMs: 1_500 })
    expect(unwrap(await runFill(db, applicant.userId, fill.id, deps))).toBe('abandoned')
  })

  test('the application request never completes: the fill is uncertain, for the owner to settle', async ({ db }) => {
    const { applicant, fill, deps } = await started(db, 'fails', presses)
    expect(unwrap(await runFill(db, applicant.userId, fill.id, deps))).toBe('uncertain')
    expect(await fillRow(db, applicant, fill.id)).toMatchObject({ status: 'uncertain', outcome: 'unknown', submission: { payload: { job_application: { first_name: 'Ana' } } } })
  })

  test('what was reviewed changed after Start: stale, and no browser opens; a redelivered job opens none either', async ({ db }) => {
    const { applicant, fill, deps, opened } = await started(db, 'accepts', presses)
    await changeAnAnswer(db, applicant.userId)
    expect(unwrap(await runFill(db, applicant.userId, fill.id, deps))).toBe('stale')
    expect(unwrap(await runFill(db, applicant.userId, fill.id, deps))).toBe('not_queued')
    expect(opened).toEqual([])
  })

  test('a lost lease closes the browser at once and writes nothing more; the fill stays uncertain', async ({ db }) => {
    const { applicant, fill, deps } = await started(db, 'accepts', async (_page, owner) => {
      await withTenant(db, owner.userId, (scope) => expireFills(scope, new Date(Date.now() + LEASE_MS * 2)))
    }, { renewEveryMs: 200 })
    expect(unwrap(await runFill(db, applicant.userId, fill.id, deps))).toBe('lease_lost')
    expect(await fillRow(db, applicant, fill.id)).toMatchObject({ status: 'uncertain', submission: null })
  })
})
