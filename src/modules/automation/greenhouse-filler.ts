import type { Page } from 'playwright'
import type { Packet, PacketItem } from '@/modules/application-answers'
import { UPLOAD } from './capture.js'
import type { FieldResult, FillReport } from './types.js'

/*
 * Fills a Greenhouse application page from a packet (decision 0016). It only enters what the
 * packet holds, sets a control the packet does not describe only when the value is certain
 * (the phone's country, from a dialing code no other country shares), and leaves everything
 * else to the owner. It never submits, and never intercepts a request.
 *
 * What the page is, from the dry run (docs/dry-runs/2026-10-28): each field's id is its API
 * field name; choices are react-select comboboxes; a several-choice question may instead be
 * checkboxes with ids "<name>_<option value>"; the API's location fields are one autocomplete,
 * `candidate-location`; a phone-country picker, `country`, is required once a phone is typed.
 */

export type FileToUpload = { readonly name: string; readonly mimeType: string; readonly buffer: Buffer }

type Fill = Extract<PacketItem, { kind: 'fill' }>

const OPTION_WAIT_MS = 5_000
/** How long Greenhouse's storage has to take an attached file. */
const UPLOAD_WAIT_MS = 30_000
const byId = (page: Page, id: string) => page.locator(`[id="${id.replaceAll('"', '\\"')}"]`)
const firstLine = (error: unknown) => (error instanceof Error ? error.message.split('\n')[0] ?? error.message : String(error))

/** What a react-select combobox displays as chosen: the chosen value sits beside its input, which empties. */
const shown = (page: Page, id: string) =>
  byId(page, id).evaluate((el) => el.closest('.select__control')?.querySelector('.select__value-container')?.textContent ?? '')

/**
 * Chooses an option of a react-select combobox by its exact label, typing `search` to find it;
 * true once the combobox displays `displayed`. Escape closes the menu and clears what was typed.
 */
async function choose(page: Page, id: string, label: string, search = label, displayed = label): Promise<boolean> {
  const input = byId(page, id)
  await input.click()
  await input.fill(search)
  const option = page.getByRole('option', { name: label, exact: true }).first()
  try {
    await option.waitFor({ timeout: OPTION_WAIT_MS })
  } catch {
    await input.press('Escape')
    return false
  }
  await option.click()
  return (await shown(page, id)).includes(displayed)
}

async function fillOne(page: Page, item: Fill, files: { readonly resume: FileToUpload | null }): Promise<FieldResult> {
  const result = (outcome: FieldResult['result'], detail: string | null = null): FieldResult =>
    ({ questionKey: item.questionKey, field: item.field, label: item.label, result: outcome, required: item.required, detail })
  const value = item.value
  try {
    if (value.kind === 'file') {
      if (!files.resume) return result('left_for_owner', 'The resume file could not be read: attach it yourself.')
      if (await byId(page, item.field).count() === 0) return result('not_on_page')
      // Attaching uploads the file at once: it is set only once Greenhouse's storage took it.
      const uploaded = page.waitForResponse((response) => UPLOAD.test(response.url()), { timeout: UPLOAD_WAIT_MS }).catch(() => null)
      await byId(page, item.field).setInputFiles(files.resume)
      const response = await uploaded
      return response && response.status() < 300 ? result('set') : result('failed', 'Greenhouse did not take the file: attach it yourself.')
    }
    if (item.field === 'location' && value.kind === 'text') return await fillLocation(page, item, value.text)
    if (value.kind === 'text') {
      if (await byId(page, item.field).count() === 0) return result('not_on_page')
      await byId(page, item.field).fill(value.text)
      return result('set')
    }
    const boxes = page.locator(`[id^="${item.field}_"][type="checkbox"]`)
    if (await boxes.count() > 0) {
      for (const option of value.options) await byId(page, `${item.field}_${option.value}`).check()
      return result('set')
    }
    if (await byId(page, item.field).count() === 0) return result('not_on_page')
    for (const option of value.options) {
      if (!await choose(page, item.field, option.label)) return result('failed', `The form offers no option "${option.label}".`)
    }
    return result('set')
  } catch (error) {
    return result('failed', firstLine(error))
  }
}

/** The location autocomplete: set only when a suggestion equals the packet's "City, Country" exactly; its coordinates come with it. */
async function fillLocation(page: Page, item: Fill, wanted: string): Promise<FieldResult> {
  const result = (outcome: FieldResult['result'], detail: string | null = null): FieldResult =>
    ({ questionKey: item.questionKey, field: item.field, label: item.label, result: outcome, required: item.required, detail })
  if (await byId(page, 'candidate-location').count() === 0) return result('not_on_page')
  return await choose(page, 'candidate-location', wanted, wanted.split(',')[0]?.trim() ?? wanted)
    ? result('set')
    : result('left_for_owner', `No location suggestion is exactly "${wanted}": choose yours on the form.`)
}

// Plain text, not a function: helpers a TypeScript build adds do not exist inside the page.
const DIAL_CODES = `[...document.querySelectorAll('li[data-dial-code][data-country-code]')].map((li) => ({
  code: li.getAttribute('data-dial-code'), name: (li.querySelector('.iti__country-name')?.textContent ?? '').trim(),
}))`

/** The phone-country picker, set only when the phone's dialing code belongs to exactly one country the picker lists. */
async function fillPhoneCountry(page: Page, phone: string | null): Promise<FieldResult | null> {
  if (await byId(page, 'country').count() === 0) return null
  const result = (outcome: FieldResult['result'], detail: string): FieldResult =>
    ({ questionKey: null, field: 'country', label: 'Phone country', result: outcome, required: phone !== null, detail })
  const digits = phone?.trim().startsWith('+') ? phone.replace(/\D/g, '') : null
  if (!digits) return phone === null ? null : result('left_for_owner', 'Your phone has no international code: choose its country on the form.')
  const listed: { code: string | null; name: string }[] = await page.evaluate(DIAL_CODES)
  const code = listed.map((c) => c.code ?? '').filter((c) => c !== '' && digits.startsWith(c)).sort((a, b) => b.length - a.length)[0]
  const countries = [...new Set(listed.filter((c) => c.code === code).map((c) => c.name))]
  const [country] = countries
  if (!code || countries.length !== 1 || !country) {
    return result('left_for_owner', `+${code ?? digits.slice(0, 3)} is shared by several countries, or none: choose your phone's country on the form.`)
  }
  // The picker lists each country with its code ("El Salvador +503"), found by name, and displays the code once chosen.
  return await choose(page, 'country', `${country} +${code}`, country, `+${code}`) ? result('set', country) : result('failed', `The phone-country picker offers no "${country} +${code}".`)
}

const LIST_CONTROLS = `[...document.querySelectorAll('form input, form textarea, form select')]
  .filter((el) => el.type !== 'hidden' && el.type !== 'submit' && el.offsetParent !== null && el.id && !el.id.startsWith('iti-'))
  .map((el) => {
    const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.textContent ?? el.getAttribute('aria-label') ?? ''
    return { id: el.id, label: label.replace(/\\s+/g, ' ').trim().slice(0, 200), required: el.required || el.getAttribute('aria-required') === 'true' }
  })`

/** Whether a text field holds what was typed. The phone field formats a number as it is typed, so a phone is compared by its digits. */
function kept(field: string, shown: string, wanted: string): boolean {
  if (field !== 'phone') return shown === wanted
  const digits = (text: string) => text.replace(/\D/g, '')
  return digits(shown) !== '' && digits(shown) === digits(wanted)
}

/** Which packet field, if any, a control on the page belongs to. */
function owner(control: string, fields: ReadonlySet<string>): boolean {
  if (fields.has(control)) return true
  if (control === 'candidate-location') return fields.has('location')
  if (control === 'country') return true
  return [...fields].some((field) => control.startsWith(`${field}_`))
}

/**
 * Fills the page from the packet, as far as it can, and reports what happened to every
 * field and to every control the page shows that the packet does not describe.
 */
export async function fillGreenhouseForm(page: Page, packet: Packet, files: { readonly resume: FileToUpload | null }): Promise<FillReport> {
  const results: FieldResult[] = []
  for (const item of packet.items) {
    if (item.kind === 'fill') results.push(await fillOne(page, item, files))
    else if (item.kind === 'unresolved') {
      results.push({ questionKey: item.questionKey, field: item.fields[0] ?? item.questionKey, label: item.label, result: 'left_for_owner', required: true, detail: `Yours to answer on the form (${item.reason}).` })
    }
  }
  // A page still taking over its server-rendered inputs can empty them: enter again any text it dropped.
  for (const [index, result] of results.entries()) {
    const item = packet.items.find((i): i is Fill => i.kind === 'fill' && i.field === result.field)
    if (result.result !== 'set' || item?.value.kind !== 'text' || item.field === 'location') continue
    const input = byId(page, item.field)
    const wanted = item.value.text
    if (kept(item.field, await input.inputValue(), wanted)) continue
    await input.fill(wanted)
    if (!kept(item.field, await input.inputValue(), wanted)) results[index] = { ...result, result: 'failed', detail: 'The page did not keep this value.' }
  }

  const phone = packet.items.find((i): i is Fill => i.kind === 'fill' && i.field === 'phone')
  const country = await fillPhoneCountry(page, phone?.value.kind === 'text' ? phone.value.text : null)
  if (country) results.push(country)

  const fields = new Set(packet.items.flatMap((i) => i.fields))
  const controls: { id: string; label: string; required: boolean }[] = await page.evaluate(LIST_CONTROLS)
  for (const control of controls) {
    if (owner(control.id, fields)) continue
    results.push({ questionKey: null, field: control.id, label: control.label, result: 'left_for_owner', required: control.required, detail: 'The page shows this control; the form data does not describe it.' })
  }
  return { fields: results }
}
