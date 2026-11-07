import { createHash } from 'node:crypto'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Packet, PacketItem } from '@/modules/application-answers'
import { GITLAB_APPLICATION, GITLAB_PAGES, replayContext, SECURITY_CODE, type Greenhouse } from './browser-fixtures.js'
import { attachCapture, judgeOutcome, type Capture } from './capture.js'
import { fillGreenhouseForm } from './greenhouse-filler.js'

/*
 * Capture against GitLab's recorded page. The tests play Greenhouse's part: S3 uploads and the
 * application request are answered or failed in the browser, never sent.
 */

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

/** The recorded page, filled, with capture attached before it opened; Greenhouse answers as told. */
async function filled(greenhouse: Greenhouse): Promise<{ context: BrowserContext; page: Page; capture: Capture }> {
  const context = await replayContext(browser, greenhouse)
  const capture = attachCapture(context, GITLAB_APPLICATION)
  const page = await context.newPage()
  await page.goto(GITLAB_PAGES.page)
  await page.locator('[id="first_name"]').waitFor()
  await page.waitForLoadState('networkidle')
  await fillGreenhouseForm(page, packet, { resume: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: PDF } })
  capture.fillerDone()
  return { context, page, capture }
}

const submit = (page: Page) => page.getByRole('button', { name: 'Submit application' }).click()
/** The owner types the emailed code into Greenhouse's eight boxes. */
async function enterCode(page: Page) {
  await page.locator('[id="security-input-0"]').waitFor()
  for (const [index, char] of [...SECURITY_CODE].entries()) await page.locator(`[id="security-input-${index}"]`).fill(char)
}
const until = async (check: () => boolean) => {
  // Generous: the whole suite runs several browsers at once.
  for (let i = 0; i < 300 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 100))
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

  it('judges an error response only once the window is done, rejected with Greenhouse\'s answer; a request that never completed is unknown', async () => {
    const rejected = await filled('rejects')
    await submit(rejected.page)
    await until(() => (rejected.capture.snapshot().submission?.response ?? null) !== null)
    // The page shows the error and lets the owner fix the field and submit again: not an outcome yet.
    expect(await judgeOutcome(rejected.page, rejected.capture.snapshot())).toBeNull()
    expect(await judgeOutcome(rejected.page, rejected.capture.snapshot(), { ended: true })).toMatchObject({
      outcome: 'rejected', evidence: { kind: 'error', status: 422, text: expect.stringContaining('invalid-attributes') },
    })
    await rejected.context.close()

    const failed = await filled('fails')
    await submit(failed.page)
    await until(() => failed.capture.snapshot().failed)
    expect(await judgeOutcome(failed.page, failed.capture.snapshot())).toMatchObject({ outcome: 'unknown' })
    await failed.context.close()
  })

  it('a security code is a step, not an outcome: the page asks for it, and the owner\'s next Submit is what is judged', async () => {
    const { context, page, capture } = await filled('asks_code')
    await submit(page)
    await until(() => (capture.snapshot().submission?.response ?? null) !== null)
    expect(capture.snapshot()).toMatchObject({ attempts: 1, submission: { response: { status: 428 } } })
    expect(await judgeOutcome(page, capture.snapshot())).toBeNull()
    // Greenhouse's own page script shows the code box for this answer.
    await enterCode(page)
    await submit(page)
    await until(() => capture.snapshot().confirmationUrl !== null)
    const snapshot = capture.snapshot()
    expect(snapshot).toMatchObject({ attempts: 2, submission: { response: { status: 200 }, payload: { job_application: { first_name: 'Ana' } } } })
    // Like the reCAPTCHA token, the one-time code proves who pressed Submit; it is not part of the application.
    expect(JSON.stringify(snapshot.submission)).not.toContain(SECURITY_CODE)
    await page.waitForLoadState()
    expect(await judgeOutcome(page, snapshot)).toMatchObject({ outcome: 'confirmed' })
    await context.close()
  })

  it('a code asked for and never entered ends rejected, unless the browser sent more after Greenhouse answered', async () => {
    const abandoned = await filled('asks_code')
    await submit(abandoned.page)
    await until(() => (abandoned.capture.snapshot().submission?.response ?? null) !== null)
    await abandoned.context.close()
    expect(abandoned.capture.snapshot().unsafeSinceAnswer).toBe(0)
    expect(await judgeOutcome(abandoned.page, abandoned.capture.snapshot(), { ended: true })).toMatchObject({
      outcome: 'rejected', evidence: { kind: 'error', status: 428, text: expect.stringContaining('captcha-failed') },
    })

    const more = await filled('asks_code')
    await submit(more.page)
    await until(() => (more.capture.snapshot().submission?.response ?? null) !== null)
    await more.page.locator('[id="cover_letter"]').setInputFiles({ name: 'letter.pdf', mimeType: 'application/pdf', buffer: PDF })
    await until(() => more.capture.snapshot().unsafeSinceAnswer > 0)
    expect(await judgeOutcome(more.page, more.capture.snapshot(), { ended: true })).toMatchObject({ outcome: 'unknown', evidence: { status: 428 } })
    await more.context.close()
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
