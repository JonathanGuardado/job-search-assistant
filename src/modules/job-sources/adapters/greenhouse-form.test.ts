import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { greenhouseAdapter } from './greenhouse.js'

// Real responses from /v1/boards/<token>/jobs/<id>?questions=true, captured 2026-10-26.
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../__fixtures__/greenhouse-application-${name}.json`, import.meta.url), 'utf8'))

const read = (payload: unknown) => {
  if (!greenhouseAdapter.readApplicationForm) throw new Error('greenhouse reads application forms')
  return greenhouseAdapter.readApplicationForm(payload)
}

describe('reading a Greenhouse application form', () => {
  it('reads every question of a long form, in order, with its section', () => {
    const result = read(fixture('canonical'))
    if (!result.ok) throw new Error(result.error.message)
    const { questions } = result.value
    expect(questions).toHaveLength(28)
    expect(questions.filter((q) => q.section === 'main')).toHaveLength(24)
    expect(questions.filter((q) => q.section === 'compliance')).toHaveLength(4)
    expect(questions[0]).toEqual({
      label: 'First Name', description: null, required: true, section: 'main', fields: [{ name: 'first_name', type: 'text', options: [] }],
    })
  })

  it('keeps every field a question offers, and option values as text', () => {
    const result = read(fixture('canonical'))
    if (!result.ok) throw new Error(result.error.message)
    const byLabel = (start: string) => result.value.questions.find((q) => q.label.startsWith(start))
    expect(byLabel('Resume/CV')?.fields).toEqual([
      { name: 'resume', type: 'file', options: [] },
      { name: 'resume_text', type: 'textarea', options: [] },
    ])
    expect(byLabel('During this application process I agree to use only my own words')).toMatchObject({
      required: true, fields: [{ name: 'question_42848303', type: 'single_select', options: [{ label: 'Yes', value: '1' }, { label: 'No', value: '0' }] }],
    })
    expect(byLabel('Please indicate your nationality')?.fields[0]?.type).toBe('multi_select')
  })

  it('reads optional compliance questions as optional', () => {
    const result = read(fixture('gitlab'))
    if (!result.ok) throw new Error(result.error.message)
    const veteran = result.value.questions.find((q) => q.label === 'VeteranStatus')
    expect(veteran).toMatchObject({ section: 'compliance', required: false, fields: [{ name: 'veteran_status', type: 'single_select' }] })
    expect(veteran?.fields[0]?.options).toContainEqual({ label: "I don't wish to answer", value: '3' })
  })

  it('reads the Datadog form', () => {
    const result = read(fixture('datadog'))
    expect(result.ok && result.value.questions.length).toBe(17)
  })

  it('reads the location section, whose coordinates the form fills itself', () => {
    const result = read(fixture('elastic'))
    if (!result.ok) throw new Error(result.error.message)
    const location = result.value.questions.filter((q) => q.section === 'location')
    expect(location.map((q) => [q.label, q.fields.map((f) => f.type)])).toEqual([['Longitude', ['hidden']], ['Latitude', ['hidden']], ['Location', ['text']]])
  })

  it('refuses a form it cannot fully read, rather than skipping a question', () => {
    const canonical = fixture('canonical')
    const unknownType = JSON.parse(JSON.stringify(canonical).replace('"input_text"', '"input_signature"'))
    expect(read(unknownType)).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    expect(read({ id: 1 })).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    const demographics = { ...(canonical as object), demographic_questions: { header: 'About you', questions: [{ id: 1, label: 'Gender', required: true }] } }
    expect(read(demographics)).toMatchObject({ ok: false, error: { code: 'invalid_input', message: expect.stringContaining('demographic') } })
  })

  it('reads data-protection consent as questions only the candidate answers, and nothing when none is required', () => {
    const canonical = fixture('canonical')
    const consents = (form: unknown) => {
      const read_ = read(form)
      if (!read_.ok) throw new Error(read_.error.message)
      return read_.value.questions.filter((q) => q.section === 'data_compliance')
    }
    // Every captured form says false to every flag.
    expect(consents(canonical)).toEqual([])
    const gdpr = { type: 'gdpr', requires_consent: true, requires_processing_consent: false, requires_retention_consent: true, retention_period: 365, demographic_data_consent_applies: true }
    const asked = consents({ ...(canonical as object), data_compliance: [gdpr] })
    expect(asked.map((q) => [q.label, q.required, q.fields.map((f) => f.type)])).toEqual([
      ['Consent to the employer storing your application data (GDPR)', true, ['consent']],
      ['Consent to the employer keeping your data for 365 days after this application (GDPR)', true, ['consent']],
      ['Consent to the employer processing your demographic answers (GDPR)', true, ['consent']],
    ])
  })

  it('refuses a form asking for a consent it does not know, rather than leaving it off', () => {
    const canonical = fixture('canonical')
    const unknown = { type: 'gdpr', requires_consent: false, requires_marketing_consent: true }
    expect(read({ ...(canonical as object), data_compliance: [unknown] })).toMatchObject({ ok: false, error: { code: 'invalid_input', message: expect.stringContaining('requires_marketing_consent') } })
  })

  it('names the pages a job\'s form is filled on, and the address its application goes to (decision 0016)', () => {
    expect(greenhouseAdapter.applicationPages?.({ name: 'Elastic', config: { token: 'elastic' } }, '8162469')).toEqual({
      page: 'https://job-boards.greenhouse.io/elastic/jobs/8162469',
      embedPage: 'https://job-boards.greenhouse.io/embed/job_app?for=elastic&token=8162469',
      applicationUrls: ['https://boards.greenhouse.io/elastic/jobs/8162469', 'https://boards.greenhouse.io/embed/elastic/jobs/8162469'],
    })
  })

  it('fetches the form from the job board API and returns the verbatim payload', async () => {
    const payload = fixture('gitlab')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload))
    if (!greenhouseAdapter.fetchApplicationForm) throw new Error('greenhouse fetches application forms')
    const result = await greenhouseAdapter.fetchApplicationForm({ name: 'GitLab', config: { token: 'gitlab' } }, '8860302002', fetcher)
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(['https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/8860302002?questions=true'])
    expect(result).toMatchObject({ ok: true, value: { payload } })
  })
})
