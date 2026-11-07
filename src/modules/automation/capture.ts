import { createHash } from 'node:crypto'
import type { BrowserContext, Page, Request } from 'playwright'
import type { CapturedSubmission, FillOutcome, OutcomeEvidence } from './types.js'

/*
 * What the browser sent, watched from the network (decision 0016). Attached to the browser
 * context before its first page opens and kept until the browser closes, it only listens:
 * it never holds, answers or aborts a request.
 *
 * Known safe, from the dry run and the filler's tests: Greenhouse's analytics, and the S3
 * upload of each file the filler attaches while it fills. Anything else that is not a read
 * (a reCAPTCHA reload, the application, an upload after filling) means a submission cannot
 * be ruled out.
 */

const READS = new Set(['GET', 'HEAD', 'OPTIONS'])
const ANALYTICS = 'https://c.spl.greenhouse.io/'
/** Greenhouse's storage, which takes each file as soon as it is attached. */
export const UPLOAD = /^https:\/\/grnhse-[^/]+\.s3\.amazonaws\.com\//
const CONFIRMATION = /^https:\/\/[^/]*greenhouse\.io\/.*\/confirmation(\?|$)/
/** Proofs of who pressed Submit, not part of the application: the reCAPTCHA token and the emailed one-time code. */
const NOT_KEPT = new Set(['g-recaptcha-enterprise-token', 'security_code'])
/** How much of Greenhouse's answer is kept as evidence. */
const ANSWER_CHARS = 1_000

type File = CapturedSubmission['files'][number]

export type CaptureSnapshot = {
  /**
   * The latest application request the browser sent. After an error answer Greenhouse's page
   * lets the owner fix the form, or enter an emailed code, and submit again.
   */
  readonly submission: CapturedSubmission | null
  /** How many application requests went out. */
  readonly attempts: number
  /** Greenhouse's answer to the latest one, as text, cut short; set together with its status. */
  readonly answer: string | null
  /** The latest application request failed before any response. */
  readonly failed: boolean
  /** The page went to Greenhouse's confirmation page. */
  readonly confirmationUrl: string | null
  /** Each request beyond the known safe ones, as "METHOD host/path". */
  readonly unsafe: readonly string[]
  /** How many of those went out after Greenhouse answered the latest application. */
  readonly unsafeSinceAnswer: number
}

export type Capture = {
  /** The filler is done: an upload from here on is the owner's, not ruled safe. */
  readonly fillerDone: () => void
  readonly snapshot: () => CaptureSnapshot
}

/** The file in an S3 upload's multipart body, by name, size and fingerprint. */
function uploadedFile(request: Request): File | null {
  const body = request.postDataBuffer()
  const boundary = /boundary=([^;]+)/.exec(request.headers()['content-type'] ?? '')?.[1]
  if (!body || !boundary) return null
  const filename = body.indexOf('filename="')
  if (filename < 0) return null
  const nameEnd = body.indexOf('"', filename + 10)
  const start = body.indexOf('\r\n\r\n', nameEnd) + 4
  const end = body.indexOf(`\r\n--${boundary}`, start)
  if (nameEnd < 0 || start < 4 || end < 0) return null
  const bytes = body.subarray(start, end)
  return { name: body.subarray(filename + 10, nameEnd).toString('utf8'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

/** The application's JSON body without the reCAPTCHA token or the security code; null if it is not complete JSON. */
function applicationPayload(request: Request): unknown {
  try {
    const payload: unknown = JSON.parse(request.postData() ?? '')
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
    return Object.fromEntries(Object.entries(payload).filter(([key]) => !NOT_KEPT.has(key)))
  } catch {
    return null
  }
}

/** Starts watching a browser context; `application` matches the form's own application URL. */
export function attachCapture(context: BrowserContext, application: RegExp): Capture {
  let fillerUploading = true
  let sent: { request: Request; capturedAt: string; payload: unknown } | null = null
  let attempts = 0
  let status: number | null = null
  let answer: string | null = null
  let unsafeAtAnswer = 0
  let failed = false
  let confirmationUrl: string | null = null
  const files: File[] = []
  const unsafe: string[] = []

  context.on('request', (request) => {
    const url = request.url()
    if (request.isNavigationRequest() && CONFIRMATION.test(url)) confirmationUrl = url
    if (READS.has(request.method()) || url.startsWith(ANALYTICS)) return
    const where = `${request.method()} ${url.split('?')[0]}`
    if (UPLOAD.test(url)) {
      const file = uploadedFile(request)
      if (file) files.push(file)
      if (!fillerUploading) unsafe.push(`a file upload after filling: ${where}`)
      return
    }
    if (request.method() === 'POST' && application.test(url.split('?')[0] ?? url)) {
      sent = { request, capturedAt: new Date().toISOString(), payload: applicationPayload(request) }
      attempts += 1
      status = null
      answer = null
      failed = false
    }
    unsafe.push(where)
  })
  context.on('response', (response) => {
    const answered = sent
    if (answered?.request !== response.request()) return
    const answeredWith = (code: number, body: string | null) => {
      if (sent !== answered) return
      answer = body === null ? null : body.replace(/\s+/g, ' ').trim().slice(0, ANSWER_CHARS)
      status = code
      unsafeAtAnswer = unsafe.length
    }
    // A success navigates away, and its body may never be readable. An error keeps the page,
    // and its status waits for the body, so a judged error always carries what Greenhouse said.
    if (response.status() < 400) answeredWith(response.status(), null)
    else void response.text().catch(() => '').then((body) => answeredWith(response.status(), body))
  })
  context.on('requestfailed', (request) => { if (sent?.request === request) failed = true })

  return {
    fillerDone: () => { fillerUploading = false },
    snapshot: () => ({
      submission: sent === null ? null : {
        url: sent.request.url(), capturedAt: sent.capturedAt, payload: sent.payload, files: [...files], response: status === null ? null : { status },
      },
      attempts, answer, failed, confirmationUrl, unsafe: [...unsafe],
      unsafeSinceAnswer: status === null ? 0 : unsafe.length - unsafeAtAnswer,
    }),
  }
}

/**
 * What Greenhouse said to the latest application: confirmed (a success response, then its
 * confirmation page), rejected (an error response), or unknown. Null before it went out, while
 * its response is still coming, and after an error response until the window is `ended`:
 * Greenhouse's page shows the error, or asks for an emailed code, and the owner may submit
 * again. An error is unknown, not rejected, if the browser sent anything after it.
 */
export async function judgeOutcome(page: Page, snapshot: CaptureSnapshot, options: { readonly ended?: boolean } = {}): Promise<{ readonly outcome: Exclude<FillOutcome, 'user_reported'>; readonly evidence: OutcomeEvidence } | null> {
  const { submission } = snapshot
  if (submission === null) return null
  if (snapshot.failed) return { outcome: 'unknown', evidence: { kind: 'error', status: null, text: 'The application request did not complete.' } }
  if (submission.response === null) return null
  const { status } = submission.response
  if (status >= 400) {
    if (!options.ended) return null
    const said = `Greenhouse answered HTTP ${status}: ${snapshot.answer || '(no message)'}`
    return snapshot.unsafeSinceAnswer === 0
      ? { outcome: 'rejected', evidence: { kind: 'error', status, text: said } }
      : { outcome: 'unknown', evidence: { kind: 'error', status, text: `${said}. The browser sent more afterwards, so a later submission cannot be ruled out.` } }
  }
  const text = await page.locator('body').innerText().then((t) => t.replace(/\s+/g, ' ').trim().slice(0, 1_000)).catch(() => '')
  if (snapshot.confirmationUrl !== null) return { outcome: 'confirmed', evidence: { kind: 'confirmation_page', url: snapshot.confirmationUrl, text } }
  return { outcome: 'unknown', evidence: { kind: 'error', status: submission.response.status, text: 'Greenhouse answered, but its confirmation page was not seen.' } }
}
