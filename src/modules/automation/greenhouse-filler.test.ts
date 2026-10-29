import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Packet, PacketItem } from '@/modules/application-answers'
import { fillGreenhouseForm } from './greenhouse-filler.js'

/*
 * The filler against GitLab's real application page, replayed offline from a recording of
 * what it loaded (scripts/greenhouse-dry-run.ts --har). Anything the recording lacks is
 * aborted, and the page's application request is never answered: nothing can be sent.
 */

const PAGE = 'https://job-boards.greenhouse.io/gitlab/jobs/8725225002'
const HAR = fileURLToPath(new URL('./__fixtures__/greenhouse-gitlab-page.har', import.meta.url))
const SPONSORSHIP = 'question_37853228002'
const AGREEMENTS = 'question_37853229002'
const LOCATED_IN = 'question_37853227002'
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')

const text = (field: string, label: string, value: string, source: 'details' | 'profile' | 'saved' = 'details'): PacketItem =>
  ({ kind: 'fill', questionKey: label.toLowerCase(), label, fields: [field], required: true, field, value: { kind: 'text', text: value }, source, origin: source === 'saved' ? 'owner' : null })
const choice = (field: string, label: string, option: string): PacketItem =>
  ({ kind: 'fill', questionKey: label.toLowerCase(), label, fields: [field], required: true, field, value: { kind: 'choice', options: [{ label: option, value: '1' }] }, source: 'saved', origin: 'owner' })

function packetOf(items: readonly PacketItem[]): Packet {
  return { jobId: 'job', rawJobId: 'raw', formFingerprint: 'form', resume: { id: 'resume', sha256: 'a'.repeat(64) }, items, fingerprint: 'packet' }
}

const complete = (overrides: { phone?: string; location?: string; sponsorship?: string } = {}) => packetOf([
  text('first_name', 'First Name', 'Ana'), text('last_name', 'Last Name', 'Pérez'), text('email', 'Email', 'ana@example.com'),
  text('phone', 'Phone', overrides.phone ?? '+503 7000 0000'),
  { kind: 'fill', questionKey: 'resume/cv', label: 'Resume/CV', fields: ['resume', 'resume_text'], required: true, field: 'resume', value: { kind: 'file', resumeId: 'resume', label: 'cv.pdf' }, source: 'resume', origin: null },
  { kind: 'empty', questionKey: 'cover letter', label: 'Cover Letter', fields: ['cover_letter', 'cover_letter_text'] },
  choice(SPONSORSHIP, 'Will you now or in the future require sponsorship?', overrides.sponsorship ?? 'No'),
  choice(AGREEMENTS, 'Are you subject to any employment agreements?', 'No'),
  choice(LOCATED_IN, 'Please choose the country in which you are located.', 'El Salvador'),
  text('location', 'Location', overrides.location ?? 'San Salvador, El Salvador', 'profile'),
  { kind: 'unresolved', questionKey: 'gender', label: 'Gender', fields: ['gender'], reason: 'unanswered' },
])

let browser: Browser
beforeAll(async () => { browser = await chromium.launch() })
afterAll(async () => { await browser.close() })

/** The recorded page, with every request it makes that is not a read recorded and aborted. */
async function formPage(): Promise<{ page: Page; sent: string[] }> {
  const context = await browser.newContext({ timezoneId: 'UTC', locale: 'en-US' })
  await context.routeFromHAR(HAR, { notFound: 'abort' })
  const sent: string[] = []
  await context.route('**/*', (route) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.fallback()
    sent.push(`${route.request().method()} ${route.request().url()}`)
    return route.abort()
  })
  const page = await context.newPage()
  await page.goto(PAGE)
  await page.locator('[id="first_name"]').waitFor()
  return { page, sent }
}

const shown = (page: Page, id: string) =>
  page.locator(`[id="${id}"]`).evaluate((el) => el.closest('.select__control')?.querySelector('.select__value-container')?.textContent ?? '')
const resultFor = (report: Awaited<ReturnType<typeof fillGreenhouseForm>>, field: string) => report.fields.find((f) => f.field === field)

describe('filling a Greenhouse form (decision 0016)', { timeout: 60_000 }, () => {
  it('fills every kind of field the packet holds, and sends nothing but the resume upload', async () => {
    const { page, sent } = await formPage()
    const report = await fillGreenhouseForm(page, complete(), { resume: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: PDF } })
    for (const field of ['first_name', 'last_name', 'email', 'phone', 'resume', SPONSORSHIP, AGREEMENTS, LOCATED_IN]) {
      expect(resultFor(report, field), field).toMatchObject({ result: 'set' })
    }
    expect(await page.locator('[id="first_name"]').inputValue()).toBe('Ana')
    expect(await shown(page, SPONSORSHIP)).toBe('No')
    // The phone's country, from a dialing code only El Salvador has; the location, from an exact suggestion.
    expect(resultFor(report, 'country')).toMatchObject({ result: 'set', detail: 'El Salvador' })
    expect(resultFor(report, 'location')).toMatchObject({ result: 'set' })
    expect(await shown(page, 'candidate-location')).toBe('San Salvador, El Salvador')
    expect(await shown(page, 'country')).toBe('+503')
    // Attaching the resume uploads it to Greenhouse's storage at once (aborted here). Nothing else is sent: no application, no reCAPTCHA.
    expect(sent.filter((request) => !request.includes('c.spl.greenhouse.io'))).toEqual(['POST https://grnhse-prod-jben-us-east-1.s3.amazonaws.com/'])
    await page.context().close()
  })

  it('leaves to the owner what it cannot set exactly: a shared dialing code, a location with no exact match, a missing option', async () => {
    const { page } = await formPage()
    const report = await fillGreenhouseForm(page, complete({ phone: '+1 415 555 0100', location: 'Atlantis, Nowhere', sponsorship: 'Maybe' }), { resume: null })
    expect(resultFor(report, 'country')).toMatchObject({ result: 'left_for_owner', required: true, detail: expect.stringContaining('+1') })
    expect(resultFor(report, 'location')).toMatchObject({ result: 'left_for_owner', detail: expect.stringContaining('Atlantis, Nowhere') })
    expect(await shown(page, 'candidate-location')).not.toContain('Atlantis')
    expect(resultFor(report, SPONSORSHIP)).toMatchObject({ result: 'failed', detail: expect.stringContaining('Maybe') })
    // No file to upload: the resume is the owner's to attach.
    expect(resultFor(report, 'resume')).toMatchObject({ result: 'left_for_owner' })
    await page.context().close()
  })

  it('reports what the packet leaves unresolved, and the page\'s controls the form data does not describe', async () => {
    const { page } = await formPage()
    const report = await fillGreenhouseForm(page, complete(), { resume: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: PDF } })
    expect(resultFor(report, 'gender')).toMatchObject({ result: 'left_for_owner', required: true, detail: expect.stringContaining('unanswered') })
    const unknown = report.fields.filter((f) => f.questionKey === null && f.field !== 'country')
    for (const control of unknown) expect(control).toMatchObject({ result: 'left_for_owner', detail: expect.stringContaining('does not describe') })
    // Every packet field the page shows was found.
    expect(report.fields.filter((f) => f.result === 'not_on_page').map((f) => f.field)).toEqual([])
    await page.context().close()
  })
})
