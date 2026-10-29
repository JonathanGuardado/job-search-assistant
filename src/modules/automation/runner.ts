import type { BrowserContext, Page } from 'playwright'
import type { Db } from '@/lib/db/client'
import { withTenant, type TenantScope } from '@/lib/db/tenancy'
import { ok, type Result } from '@/lib/result'
import { buildPacket } from '@/modules/application-answers'
import type { ApplicationPages, PostingRef } from '@/modules/job-sources'
import { getJob } from '@/modules/jobs'
import { readResumeFile } from '@/modules/resumes'
import { attachCapture, judgeOutcome, type Capture, type CaptureSnapshot } from './capture.js'
import { fillGreenhouseForm, type FileToUpload } from './greenhouse-filler.js'
import {
  claimFill, endAttempt, finishRecording, markFilling, markStale, recordReport, recordSubmission, renewLease, type Fill,
} from './service.js'
import type { FillStatus } from './types.js'

/*
 * The worker's run of one fill (decision 0016): claim it, check that what the owner reviewed
 * still holds, open a visible browser, fill the form, and wait for the owner to submit it or
 * close the window. Every step is its own short write; the browser never waits inside a
 * transaction. After the browser opens, any end that the network cannot rule out as unsent is
 * recorded uncertain.
 */

export type BrowserSession = { readonly context: BrowserContext; readonly close: () => Promise<void> }

export type RunnerDeps = {
  /** Names this worker as the lease holder. */
  readonly worker: string
  readonly storageRoot: string
  /** A fresh browser context with no pages and no Greenhouse cookies. */
  readonly openBrowser: () => Promise<BrowserSession>
  /** Fetches the job's form again, so the packet is compared with the form as it is now. */
  readonly refreshForm: (posting: PostingRef) => Promise<Result<unknown>>
  readonly pages: (posting: PostingRef) => Promise<Result<ApplicationPages>>
  /** How long the owner has to submit after the form is filled. */
  readonly waitMs: number
  readonly pollMs: number
  readonly renewEveryMs: number
  /** How long the browser stays open after a recorded submission, unless the owner closes it first. */
  readonly lingerMs: number
  /** Tests only: plays the owner once the form is filled. The real owner uses the visible browser. */
  readonly owner?: (page: Page) => Promise<void>
}

/** stale: what was reviewed changed, no browser opened; lease_lost: someone else changed the fill, and the browser was closed. */
export type RunOutcome = 'not_queued' | 'lease_lost' | FillStatus

/** After a success response, how long to wait for Greenhouse's confirmation page before calling the outcome unknown. */
const CONFIRMATION_WAIT_MS = 15_000
/** After the application went out, how long to wait for any response. */
const RESPONSE_WAIT_MS = 60_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const messageOf = (error: unknown) => (error instanceof Error ? error.message.split('\n')[0] ?? error.message : String(error))

type Ending =
  | { readonly kind: 'judged'; readonly outcome: 'confirmed' | 'rejected' | 'unknown'; readonly evidence: NonNullable<Fill['outcomeEvidence']> }
  | { readonly kind: 'closed' | 'timeout' | 'lease_lost' }

export async function runFill(db: Db, userId: string, fillId: string, deps: RunnerDeps): Promise<Result<RunOutcome>> {
  const as = <T>(work: (scope: TenantScope) => Promise<T>) => withTenant(db, userId, work)
  const fill = await as((scope) => claimFill(scope, fillId, deps.worker))
  if (!fill) return ok('not_queued')
  const stale = async (why: string): Promise<Result<RunOutcome>> => {
    await as((scope) => markStale(scope, fillId, deps.worker, why))
    return ok('stale')
  }

  // Before any browser: what the owner reviewed must still hold.
  const job = await getJob(db, fill.jobId)
  if (!job.ok) return stale(job.error.message)
  const refreshed = await deps.refreshForm(job.value)
  if (!refreshed.ok) return stale(`The form could not be fetched again: ${refreshed.error.message}`)
  const packet = await buildPacket(db, userId, fill.jobId)
  if (!packet.ok) return stale(packet.error.message)
  if (packet.value.fingerprint !== fill.packetHash) return stale('Your answers, the resume, the form or the posting changed since you reviewed it.')
  let resume: FileToUpload | null = null
  if (fill.packet.resume) {
    const file = await as((scope) => readResumeFile(scope, fill.packet.resume?.id ?? '', { storageRoot: deps.storageRoot }))
    if (!file.ok || file.value.sha256 !== fill.packet.resume.sha256) return stale('The reviewed resume file could not be read as it was.')
    resume = { name: file.value.filename, mimeType: file.value.contentType, buffer: Buffer.from(file.value.bytes) }
  }
  const pages = await deps.pages(job.value)
  if (!pages.ok) return stale(pages.error.message)

  // From here the browser is open: only the network can rule out a submission.
  let session: BrowserSession | null = null
  let capture: Capture | null = null
  try {
    session = await deps.openBrowser()
    capture = attachCapture(session.context, new RegExp(`^(${pages.value.applicationUrls.map(escapeRegExp).join('|')})$`))
    const filling = await as((scope) => markFilling(scope, fillId, deps.worker))
    if (!filling.ok) return await leaseLost(session)
    const page = await session.context.newPage()
    await page.goto(pages.value.page)
    // A board embedded on the employer's own site redirects there; its form lives on Greenhouse's embed page.
    if (!new URL(page.url()).hostname.endsWith('greenhouse.io')) await page.goto(pages.value.embedPage)
    await page.locator('[id="first_name"]').waitFor({ timeout: 30_000 })
    // Filling before the page's scripts take over its inputs can lose what was typed.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    const report = await fillGreenhouseForm(page, fill.packet, { resume })
    capture.fillerDone()
    const waiting = await as((scope) => recordReport(scope, fillId, deps.worker, report))
    if (!waiting.ok) return await leaseLost(session)
    if (deps.owner) void deps.owner(page).catch(() => {})

    const ending = await waitForOwner(page, session.context, capture, (now) => as((scope) => renewLease(scope, fillId, deps.worker, now)), deps)
    if (ending.kind === 'lease_lost') return await leaseLost(session)
    if (ending.kind === 'judged') return await recorded(ending, page, session, capture.snapshot())
    await session.close()
    return await ended(capture.snapshot().unsafe.length === 0, ending.kind, ending.kind === 'closed' ? 'The browser window was closed.' : 'The time to submit ran out.')
  } catch (error) {
    const closed = await session?.close().then(() => true, () => false) ?? true
    const snapshot = capture?.snapshot() ?? null
    const submission = snapshot?.submission
    if (submission) {
      const unsure = await as((scope) => recordSubmission(scope, fillId, deps.worker, { submission, outcome: 'unknown', evidence: { kind: 'error', status: null, text: messageOf(error) } }))
      return ok(unsure.ok ? unsure.value.status : 'lease_lost')
    }
    // No capture means the browser never opened a page: nothing could have been sent.
    return ended(closed && (snapshot === null || snapshot.unsafe.length === 0), 'error', messageOf(error))
  }

  async function leaseLost(open: BrowserSession): Promise<Result<RunOutcome>> {
    await open.close().catch(() => {})
    return ok('lease_lost')
  }

  async function ended(ruledOut: boolean, ending: 'closed' | 'timeout' | 'error', detail: string): Promise<Result<RunOutcome>> {
    const result = await as((scope) => endAttempt(scope, fillId, deps.worker, { ruledOut, ending, detail }))
    return ok(result.ok ? result.value.status : 'lease_lost')
  }

  /** The first write records what was sent and Greenhouse's answer; the second, in its own transaction, the application. */
  async function recorded(judged: Extract<Ending, { kind: 'judged' }>, page: Page, open: BrowserSession, snapshot: CaptureSnapshot): Promise<Result<RunOutcome>> {
    const submission = snapshot.submission
    if (!submission) throw new Error('a judged outcome always has a captured submission')
    const first = await as((scope) => recordSubmission(scope, fillId, deps.worker, { submission, outcome: judged.outcome, evidence: judged.evidence }))
    if (!first.ok) return leaseLost(open)
    // The owner sees Greenhouse's answer before the browser closes, unless they close it first.
    await Promise.race([page.waitForEvent('close', { timeout: 0 }).catch(() => {}), sleep(deps.lingerMs)])
    await open.close().catch(() => {})
    if (first.value.status === 'submitted') {
      // If this fails, the fill keeps its slot until "finish recording" completes it.
      await as((scope) => finishRecording(scope, fillId, new Date().toISOString().slice(0, 10))).catch(() => null)
    }
    return ok(first.value.status)
  }
}

/**
 * Waits for the first of: Greenhouse's answer to a submission, the window closing, the time
 * running out, or the lease being lost. Renews the lease while it waits.
 */
async function waitForOwner(page: Page, context: BrowserContext, capture: Capture, renew: (now: Date) => Promise<boolean>, deps: RunnerDeps): Promise<Ending> {
  let closed = false
  page.on('close', () => { closed = true })
  context.on('close', () => { closed = true })
  const started = Date.now()
  let renewed = started
  let sentAt: number | null = null
  let answeredAt: number | null = null
  for (;;) {
    const now = Date.now()
    if (now - renewed >= deps.renewEveryMs) {
      if (!await renew(new Date(now))) return { kind: 'lease_lost' }
      renewed = now
    }
    const snapshot = capture.snapshot()
    if (snapshot.submission) {
      sentAt ??= now
      if (snapshot.submission.response) answeredAt ??= now
      const judged = closed ? null : await judgeOutcome(page, snapshot)
      const waitingForConfirmation = judged?.outcome === 'unknown' && answeredAt !== null && !snapshot.failed && now - answeredAt < CONFIRMATION_WAIT_MS
      if (judged && !waitingForConfirmation) return { kind: 'judged', ...judged }
      const gaveUp = closed || now - started >= deps.waitMs || (answeredAt === null && now - sentAt >= RESPONSE_WAIT_MS)
      if (gaveUp) {
        const final = await judgeOutcome(page, snapshot)
        return final && final.outcome !== 'unknown'
          ? { kind: 'judged', ...final }
          : { kind: 'judged', outcome: 'unknown', evidence: { kind: 'error', status: snapshot.submission.response?.status ?? null, text: 'The application went out, but Greenhouse\'s answer was not seen.' } }
      }
    } else if (closed) {
      return { kind: 'closed' }
    } else if (now - started >= deps.waitMs) {
      return { kind: 'timeout' }
    }
    await sleep(deps.pollMs)
  }
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
