import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Packet, PacketItem } from '@/modules/application-answers'
import { attachCapture, judgeOutcome, type Capture } from './capture.js'
import { fillGreenhouseForm } from './greenhouse-filler.js'

/*
 * Capture against GitLab's recorded page. The tests play Greenhouse's part: S3 uploads and the
 * application request are answered or failed in the browser, never sent.
 */

const PAGE = 'https://job-boards.greenhouse.io/gitlab/jobs/8725225002'
const APPLICATION = /^https:\/\/boards\.greenhouse\.io\/(embed\/)?gitlab\/jobs\/8725225002$/
const HAR = fileURLToPath(new URL('./__fixtures__/greenhouse-gitlab-page.har', import.meta.url))
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')

const text = (field: string, value: string): PacketItem =>
  ({ kind: 'fill', questionKey: field, label: field, fields: [field], required: true, field, value: { kind: 'text', text: value }, source: 'details', origin: null })
const choice = (field: string, option: string): PacketItem =>
  ({ kind: 'fill', questionKey: field, label: field, fields: [field], required: true, field, value: { kind: 'choice', options: [{ label: option, value: '1' }] }, source: 'saved', origin: 'owner' })
const packet: Packet = {
  jobId: 'job', rawJobId: 'raw', formFingerprint: 'form', resume: { id: 'resume', sha256: 'a'.repeat(64) }, fingerprint: 'packet',
  items: [
    text('first_name', 'Ana'), text('last_name', 'Pérez'), text('email', 'ana@example.com'), text('phone', '+503 7000 0000'),
    { kind: 'fill', questionKey: 'resume', label: 'Resume/CV', fields: ['resume', 'resume_text'], required: true, field: 'resume', value: { kind: 'file', resumeId: 'resume', label: 'cv.pdf' }, source: 'resume', origin: null },
    choice('question_37853228002', 'No'), choice('question_37853229002', 'No'), text('location', 'San Salvador, El Salvador'),
  ],
}

let browser: Browser
beforeAll(async () => { browser = await chromium.launch() })
afterAll(async () => { await browser.close() })

type Greenhouse = 'accepts' | 'rejects' | 'fails'

/** The recorded page, filled, with capture attached before it opened; Greenhouse answers as told. */
async function filled(greenhouse: Greenhouse): Promise<{ context: BrowserContext; page: Page; capture: Capture }> {
  const context = await browser.newContext({ timezoneId: 'UTC', locale: 'en-US' })
  const capture = attachCapture(context, APPLICATION)
  await context.routeFromHAR(HAR, { notFound: 'abort' })
  await context.route('**/*', (route) => answer(route, greenhouse))
  const page = await context.newPage()
  await page.goto(PAGE)
  await page.locator('[id="first_name"]').waitFor()
  await fillGreenhouseForm(page, packet, { resume: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: PDF } })
  capture.fillerDone()
  return { context, page, capture }
}

function answer(route: Route, greenhouse: Greenhouse) {
  const request = route.request()
  if (request.isNavigationRequest() && request.url().endsWith('/confirmation')) {
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><h1>Thank you for applying.</h1></body></html>' })
  }
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.fallback()
  if (request.url().includes('.s3.amazonaws.com')) {
    const key = /name="key"\r?\n\r?\n([^\r\n]+)/.exec(request.postData() ?? '')?.[1] ?? 'key'
    return route.fulfill({
      status: 201, contentType: 'application/xml', headers: { 'access-control-allow-origin': '*' },
      body: `<?xml version="1.0"?><PostResponse><Location>${request.url()}${key}</Location><Bucket>b</Bucket><Key>${key}</Key><ETag>"0"</ETag></PostResponse>`,
    })
  }
  if (APPLICATION.test(request.url())) {
    if (greenhouse === 'fails') return route.abort('connectionreset')
    return route.fulfill({ status: greenhouse === 'accepts' ? 200 : 422, contentType: 'application/json', body: greenhouse === 'accepts' ? '{}' : '{"errors":["Email is invalid"]}' })
  }
  return route.abort()
}

const submit = (page: Page) => page.getByRole('button', { name: 'Submit application' }).click()
const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 100))
}

describe('capturing what the browser sent (decision 0016)', { timeout: 60_000 }, () => {
  it('captures the application whole, without the reCAPTCHA token, its files by fingerprint, and a confirmed outcome', async () => {
    const { context, page, capture } = await filled('accepts')
    await submit(page)
    await until(() => capture.snapshot().confirmationUrl !== null)
    const snapshot = capture.snapshot()
    expect(snapshot.submission).toMatchObject({
      url: 'https://boards.greenhouse.io/gitlab/jobs/8725225002', response: { status: 200 },
      payload: { job_application: { first_name: 'Ana', email: 'ana@example.com', location: 'San Salvador, El Salvador' } },
      files: [{ name: 'cv.pdf', size: PDF.length, sha256: createHash('sha256').update(PDF).digest('hex') }],
    })
    expect(JSON.stringify(snapshot.submission)).not.toContain('recaptcha')
    expect(snapshot.unsafe).not.toEqual([])
    await page.waitForLoadState()
    expect(await judgeOutcome(page, snapshot)).toMatchObject({ outcome: 'confirmed', evidence: { kind: 'confirmation_page', url: expect.stringContaining('/confirmation'), text: expect.stringContaining('Thank you') } })
    await context.close()
  })

  it('judges an error response rejected and a request that never completed unknown', async () => {
    const rejected = await filled('rejects')
    await submit(rejected.page)
    await until(() => rejected.capture.snapshot().submission?.response !== null && rejected.capture.snapshot().submission !== null)
    expect(await judgeOutcome(rejected.page, rejected.capture.snapshot())).toMatchObject({ outcome: 'rejected', evidence: { kind: 'error', status: 422 } })
    await rejected.context.close()

    const failed = await filled('fails')
    await submit(failed.page)
    await until(() => failed.capture.snapshot().failed)
    expect(await judgeOutcome(failed.page, failed.capture.snapshot())).toMatchObject({ outcome: 'unknown' })
    await failed.context.close()
  })

  it('records what was actually sent after the owner edits the form, however Submit is pressed', async () => {
    const { context, page, capture } = await filled('accepts')
    await page.locator('[id="first_name"]').fill('Anita')
    await page.locator('[id="last_name"]').press('Enter')
    await until(() => capture.snapshot().submission !== null)
    expect(capture.snapshot().submission).toMatchObject({ payload: { job_application: { first_name: 'Anita' } } })
    await context.close()
  })

  it('sees nothing unsafe when the window closes unsubmitted; a file the owner uploads after filling is not ruled safe', async () => {
    const quiet = await filled('accepts')
    await quiet.context.close()
    expect(quiet.capture.snapshot()).toMatchObject({ unsafe: [], submission: null })
    expect(await judgeOutcome(quiet.page, quiet.capture.snapshot())).toBeNull()

    const upload = await filled('accepts')
    await upload.page.locator('[id="cover_letter"]').setInputFiles({ name: 'letter.pdf', mimeType: 'application/pdf', buffer: PDF })
    await until(() => upload.capture.snapshot().unsafe.length > 0)
    expect(upload.capture.snapshot().unsafe).toEqual([expect.stringContaining('upload')])
    await upload.context.close()
  })
})
