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
const RECAPTCHA_TOKEN = 'g-recaptcha-enterprise-token'

type File = CapturedSubmission['files'][number]

export type CaptureSnapshot = {
  /** The application request, once the browser sent one. */
  readonly submission: CapturedSubmission | null
  /** The application request failed before any response. */
  readonly failed: boolean
  /** The page went to Greenhouse's confirmation page. */
  readonly confirmationUrl: string | null
  /** Each request beyond the known safe ones, as "METHOD host/path". */
  readonly unsafe: readonly string[]
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

/** The application's JSON body without the reCAPTCHA token; null if it is not complete JSON. */
function applicationPayload(request: Request): unknown {
  try {
    const payload: unknown = JSON.parse(request.postData() ?? '')
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
    return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== RECAPTCHA_TOKEN))
  } catch {
    return null
  }
}

/** Starts watching a browser context; `application` matches the form's own application URL. */
export function attachCapture(context: BrowserContext, application: RegExp): Capture {
  let fillerUploading = true
  let sent: { request: Request; capturedAt: string; payload: unknown } | null = null
  let status: number | null = null
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
    if (request.method() === 'POST' && application.test(url.split('?')[0] ?? url) && sent === null) {
      sent = { request, capturedAt: new Date().toISOString(), payload: applicationPayload(request) }
    }
    unsafe.push(where)
  })
  context.on('response', (response) => { if (sent?.request === response.request()) status = response.status() })
  context.on('requestfailed', (request) => { if (sent?.request === request) failed = true })

  return {
    fillerDone: () => { fillerUploading = false },
    snapshot: () => ({
      submission: sent === null ? null : {
        url: sent.request.url(), capturedAt: sent.capturedAt, payload: sent.payload, files: [...files], response: status === null ? null : { status },
      },
      failed, confirmationUrl, unsafe: [...unsafe],
    }),
  }
}

/**
 * What Greenhouse said, once the application went out: confirmed (a success response, then
 * its confirmation page), rejected (an error response), or unknown. Null before it went out,
 * and while its response is still coming.
 */
export async function judgeOutcome(page: Page, snapshot: CaptureSnapshot): Promise<{ readonly outcome: Exclude<FillOutcome, 'user_reported'>; readonly evidence: OutcomeEvidence } | null> {
  const { submission } = snapshot
  if (submission === null) return null
  if (snapshot.failed) return { outcome: 'unknown', evidence: { kind: 'error', status: null, text: 'The application request did not complete.' } }
  if (submission.response === null) return null
  const text = await page.locator('body').innerText().then((t) => t.replace(/\s+/g, ' ').trim().slice(0, 1_000)).catch(() => '')
  if (submission.response.status >= 400) return { outcome: 'rejected', evidence: { kind: 'error', status: submission.response.status, text } }
  if (snapshot.confirmationUrl !== null) return { outcome: 'confirmed', evidence: { kind: 'confirmation_page', url: snapshot.confirmationUrl, text } }
  return { outcome: 'unknown', evidence: { kind: 'error', status: submission.response.status, text: 'Greenhouse answered, but its confirmation page was not seen.' } }
}
