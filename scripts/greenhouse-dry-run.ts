import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Page, type Request } from 'playwright'

/*
 * Milestone 2.3, step 0: what a Greenhouse application page loads, which controls it renders,
 * and (with --submit) the request Submit would send. Never sends anything: every request
 * that is not a read is recorded and aborted before it leaves the browser, and only made-up
 * values are typed. Interception like this belongs here and in tests, never in the filler.
 *
 *   pnpm tsx scripts/greenhouse-dry-run.ts <out-dir> [--har] [--submit <board> <job-id>] <form-url>…
 *
 * --har also records what the page loaded from Greenhouse, reads only, to <out-dir>/<page>.har:
 * the automation module's tests replay it offline.
 *
 * --submit fills every question the board's API lists with made-up values (the first option
 * of each choice, a one-page fake PDF), presses Submit, and records the requests it makes.
 * A run is conclusive only when it captured the application request itself, to
 * boards.greenhouse.io/[embed/]<board>/jobs/<id>, with a complete JSON body. It writes that
 * capture to <out-dir>/<board>-<job-id>.capture.json, without the reCAPTCHA token or the S3
 * upload signatures, and exits non-zero when any run is inconclusive.
 */

const READS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Plain text, not a function: tsx's emitted helpers do not exist inside the page.
const LIST_CONTROLS = `(() => {
  const labelOf = (el) => {
    const id = el.getAttribute('id')
    const byFor = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]')?.textContent : null
    return (byFor ?? el.closest('label')?.textContent ?? el.getAttribute('aria-label') ?? '').trim().replace(/\\s+/g, ' ').slice(0, 120)
  }
  return [...document.querySelectorAll('input, select, textarea, button, [role="combobox"], [role="listbox"], [contenteditable="true"]')].map((el) => ({
    tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), id: el.getAttribute('id'), name: el.getAttribute('name'),
    role: el.getAttribute('role'), required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
    label: labelOf(el), visible: el.offsetParent !== null,
  }))
})()`

/** sent: a read, let through; aborted: never left the browser; mocked: answered in the browser, never sent. */
type Seen = { method: string; url: string; type: string; outcome: 'sent' | 'aborted' | 'mocked'; postData: string | null }

type ApiQuestion = { label: string; required: boolean; fields: { name: string; type: string; values: { label: string; value: number | string }[] }[] }

const FAKE_PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')

/** Fills each API field with a made-up value; returns what happened to each. */
async function fillFake(page: Page, questions: readonly ApiQuestion[]): Promise<Record<string, string>> {
  const report: Record<string, string> = {}
  for (const question of questions) {
    for (const field of question.fields) {
      const id = field.name
      const target = page.locator(`[id="${id}"]`)
      try {
        if (await target.count() === 0) { report[id] = 'not on page'; continue }
        if (field.type === 'input_file') {
          await target.setInputFiles({ name: 'test-resume.pdf', mimeType: 'application/pdf', buffer: FAKE_PDF })
          report[id] = 'file set'
        } else if (field.type === 'input_text' || field.type === 'textarea') {
          await target.fill(id === 'email' ? 'dry-run@example.invalid' : 'Test value')
          report[id] = 'typed'
        } else if (field.type === 'multi_value_multi_select' && await page.locator(`[id^="${id}_"][type="checkbox"]`).count() > 0) {
          await page.locator(`[id^="${id}_"][type="checkbox"]`).first().check()
          report[id] = 'checked the first box'
        } else if (field.type.startsWith('multi_value')) {
          const option = field.values[0]
          if (!option) { report[id] = 'no options'; continue }
          await target.click()
          await target.fill(option.label)
          const choice = page.getByRole('option', { name: option.label, exact: true }).first()
          await choice.click({ timeout: 3_000 })
          report[id] = `chose "${option.label}"`
        } else {
          report[id] = `skipped ${field.type}`
        }
      } catch (error) {
        report[id] = `failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
      }
    }
  }
  // Controls the API does not describe: the phone's country and the location autocomplete.
  for (const [id, text] of [['country', 'El Salvador'], ['candidate-location', 'San Salvador']] as const) {
    const target = page.locator(`[id="${id}"]`)
    try {
      if (await target.count() === 0) { report[id] = 'not on page'; continue }
      await target.click()
      await target.fill(text)
      await page.getByRole('option').first().click({ timeout: 5_000 })
      report[id] = `chose the first option for "${text}"`
    } catch (error) {
      report[id] = `failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
    }
  }
  return report
}

/** The S3 upload's form fields, by name only: their values are a signed upload policy. */
const fieldNames = (body: string | null) => [...(body ?? '').matchAll(/name="([^"]+)"/g)].map((m) => m[1])

type Capture = { conclusive: boolean; reason: string; application: { url: string; payload: unknown } | null }

/** The application request among those Submit made, if it was captured whole. */
function applicationRequest(after: readonly Seen[], submit: { board: string; jobId: string }): Capture {
  const path = new RegExp(`^https://boards\\.greenhouse\\.io/(embed/)?${submit.board}/jobs/${submit.jobId}$`)
  const request = after.find((r) => r.method === 'POST' && r.outcome === 'aborted' && path.test(r.url))
  if (!request) return { conclusive: false, reason: 'no application request was seen after Submit', application: null }
  try {
    const payload: unknown = JSON.parse(request.postData ?? '')
    if (typeof payload !== 'object' || payload === null || !('job_application' in payload)) {
      return { conclusive: false, reason: 'the application request has no job_application', application: null }
    }
    const kept = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'g-recaptcha-enterprise-token'))
    return { conclusive: true, reason: 'captured the application request whole', application: { url: request.url, payload: kept } }
  } catch {
    return { conclusive: false, reason: 'the application request body is not complete JSON', application: null }
  }
}

/** Keeps a recording's reads only: nothing the page tried to send, made up or not, stays in a fixture. */
async function keepReads(harPath: string): Promise<void> {
  const har: { log: { entries: { request: { method: string } }[] } } = JSON.parse(await readFile(harPath, 'utf8'))
  har.log.entries = har.log.entries.filter((entry) => READS.has(entry.request.method))
  await writeFile(harPath, JSON.stringify(har))
}

async function inspect(url: string, outDir: string, submit: { board: string; jobId: string } | null, har: boolean): Promise<boolean> {
  const browser = await chromium.launch()
  const slug = new URL(url).pathname.replaceAll('/', '_') + new URL(url).search.replace(/[^a-z0-9]/gi, '_')
  const harPath = join(outDir, `${slug}.har`)
  // A neutral time zone and locale: the page sends the browser's time zone with the application.
  const context = await browser.newContext({
    timezoneId: 'UTC', locale: 'en-US', ...(har ? { recordHar: { path: harPath, content: 'embed' as const, urlFilter: /greenhouse\.io/ } } : {}),
  })
  const seen: Seen[] = []
  await context.route('**/*', async (route) => {
    const request = route.request()
    if (READS.has(request.method())) return route.continue()
    // A file goes to Greenhouse's S3 bucket before the application is sent: answer as S3 would, without sending it.
    if (request.url().includes('.s3.amazonaws.com')) {
      seen.push(describe(request, 'mocked'))
      const key = /name="key"\r?\n\r?\n([^\r\n]+)/.exec(request.postData() ?? '')?.[1] ?? 'dry-run/test-resume.pdf'
      return route.fulfill({
        status: 201, contentType: 'application/xml', headers: { 'access-control-allow-origin': '*' },
        body: `<?xml version="1.0" encoding="UTF-8"?><PostResponse><Location>${request.url()}${key}</Location><Bucket>dry-run</Bucket><Key>${key}</Key><ETag>"0"</ETag></PostResponse>`,
      })
    }
    seen.push(describe(request, 'aborted'))
    return route.abort()
  })
  context.on('request', (request) => { if (READS.has(request.method())) seen.push(describe(request, 'sent')) })

  const page = await context.newPage()
  const response = await page.goto(url, { waitUntil: 'networkidle' })
  const controls: unknown[] = await page.evaluate(LIST_CONTROLS)
  let filled: Record<string, string> | null = null
  let invalid: unknown = null
  const before = seen.length
  if (submit) {
    const api = await (await fetch(`https://boards-api.greenhouse.io/v1/boards/${submit.board}/jobs/${submit.jobId}?questions=true`)).json() as { questions: ApiQuestion[]; location_questions?: ApiQuestion[] | null; compliance?: { questions: ApiQuestion[] | null }[] | null }
    filled = await fillFake(page, [...api.questions, ...(api.location_questions ?? []), ...(api.compliance ?? []).flatMap((c) => c.questions ?? [])])
    await page.getByRole('button', { name: 'Submit application' }).click()
    await page.waitForTimeout(8_000)
    invalid = await page.evaluate(`[...document.querySelectorAll('[aria-invalid="true"]')].map((el) => el.id)`)
  }
  const afterSubmit = submit ? seen.slice(before).filter((r) => r.outcome !== 'sent') : []
  const frames = page.frames().map((f) => f.url())
  await writeFile(join(outDir, `${slug}.html`), await page.content())
  const capture = submit ? applicationRequest(afterSubmit, submit) : null
  if (submit && capture) {
    await writeFile(join(outDir, `${submit.board}-${submit.jobId}.capture.json`), `${JSON.stringify({
      formUrl: url, checkedAt: new Date().toISOString(), conclusive: capture.conclusive, reason: capture.reason,
      requestsAfterSubmit: afterSubmit.map((r) => ({ method: r.method, url: r.url.split('?')[0], outcome: r.outcome })),
      fields: filled, invalidAfterSubmit: invalid, application: capture.application,
    }, null, 2)}\n`)
    console.log(`${capture.conclusive ? 'CONCLUSIVE' : 'INCONCLUSIVE'}: ${capture.reason}`)
  }
  await writeFile(join(outDir, `${slug}.json`), JSON.stringify({ url, finalUrl: page.url(), status: response?.status() ?? null, frames, controls, filled, invalid, afterSubmit, requests: seen }, null, 2))
  if (submit) console.log(JSON.stringify({ filled, invalid, afterSubmit: afterSubmit.map((r) => `${r.method} ${r.url.slice(0, 120)}${r.outcome === 'sent' ? '' : ` (${r.outcome})`}`) }, null, 2))
  console.log(`${url}\n  → ${page.url()} (${response?.status()})  frames: ${frames.length}  controls: ${controls.length}  requests: ${seen.length}, aborted: ${seen.filter((s) => s.outcome === 'aborted').length}, mocked: ${seen.filter((s) => s.outcome === 'mocked').length}`)
  await context.close()
  await browser.close()
  if (har) await keepReads(harPath)
  return capture?.conclusive ?? true
}

function describe(request: Request, outcome: Seen['outcome']): Seen {
  const body = outcome === 'sent' ? null : request.postData()
  return { method: request.method(), url: request.url(), type: request.resourceType(), outcome, postData: outcome === 'mocked' ? fieldNames(body).join(', ') : body }
}

const [outDir, ...flagged] = process.argv.slice(2)
const har = flagged[0] === '--har'
const rest = har ? flagged.slice(1) : flagged
const submit = rest[0] === '--submit' && rest[1] && rest[2] ? { board: rest[1], jobId: rest[2] } : null
const urls = submit ? rest.slice(3) : rest
if (!outDir || urls.length === 0) throw new Error('usage: greenhouse-dry-run.ts <out-dir> [--har] [--submit <board> <job-id>] <form-url>…')
await mkdir(outDir, { recursive: true })
let conclusive = true
for (const url of urls) conclusive = (await inspect(url, outDir, submit, har)) && conclusive
if (!conclusive) process.exitCode = 1
