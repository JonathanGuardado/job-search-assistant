import { describe, expect, it } from 'vitest'
import type { ApplicationForm, FormQuestion } from '@/modules/job-sources'
import { assessReadiness, questionKey, standardField, type ReadinessInput } from './readiness.js'

const text = (label: string, name: string, required = true, section: FormQuestion['section'] = 'main'): FormQuestion =>
  ({ label, description: null, required, section, fields: [{ name, type: 'text', options: [] }] })
const choice = (label: string, name: string, options: string[], required = true, type: 'single_select' | 'multi_select' = 'single_select'): FormQuestion =>
  ({ label, description: null, required, section: 'main', fields: [{ name, type, options: options.map((o, i) => ({ label: o, value: String(i) })) }] })
const essay = (label: string, name: string, required = true): FormQuestion =>
  ({ label, description: null, required, section: 'main', fields: [{ name, type: 'textarea', options: [] }] })
const resume: FormQuestion = {
  label: 'Resume/CV', description: null, required: true, section: 'main',
  fields: [{ name: 'resume', type: 'file', options: [] }, { name: 'resume_text', type: 'textarea', options: [] }],
}
const standard = [text('First Name', 'first_name'), text('Last Name', 'last_name'), text('Email', 'email'), text('Phone', 'phone', false), resume]

const input = (overrides: Partial<ReadinessInput> = {}): ReadinessInput => ({
  details: { firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.com', phone: '+503 7000 0000', linkedinUrl: 'https://www.linkedin.com/in/ana', githubUrl: null, websiteUrl: null },
  resume: { id: '00000000-0000-4000-8000-000000000001', label: 'Version 3 · resume.pdf' },
  profile: { country: 'SV', city: 'San Salvador' },
  savedAnswers: [],
  ...overrides,
})
const form = (questions: FormQuestion[]): ApplicationForm => ({ questions })

describe('questionKey: the same question, however it is spaced or punctuated', () => {
  it('ignores case, spacing and trailing punctuation', () => {
    expect(questionKey('  How did you perform in Mathematics at high school?  ')).toBe(questionKey('how did you perform in mathematics   at high school'))
    expect(questionKey('LinkedIn Profile *')).toBe(questionKey('linkedin profile'))
  })
  it('keeps different questions apart', () => {
    expect(questionKey('Are you authorized to work in the US?')).not.toBe(questionKey('Are you authorized to work in Canada?'))
  })
})

describe('assessReadiness', () => {
  it('fills the standard fields from the details and the newest resume', () => {
    const readiness = assessReadiness(form(standard), input())
    expect(readiness.status).toBe('ready')
    expect(readiness.answers.map((a) => [a.question.label, a.source, a.field])).toEqual([
      ['First Name', 'details', 'first_name'], ['Last Name', 'details', 'last_name'], ['Email', 'details', 'email'],
      ['Phone', 'details', 'phone'], ['Resume/CV', 'resume', 'resume'],
    ])
    expect(readiness.answers[4]?.value).toEqual({ kind: 'file', resumeId: '00000000-0000-4000-8000-000000000001', label: 'Version 3 · resume.pdf' })
  })

  it('blocks on every required standard field it cannot fill, and never on an optional one', () => {
    const readiness = assessReadiness(form(standard), input({ details: null, resume: null }))
    expect(readiness.status).toBe('blocked')
    expect(readiness.blockers.map((b) => b.question.label)).toEqual(['First Name', 'Last Name', 'Email', 'Resume/CV'])
    expect(readiness.answers.find((a) => a.question.label === 'Phone')).toMatchObject({ source: 'none', blocker: null })
  })

  it('fills links and the country of residence from the profile, and nationality never', () => {
    const questions = [
      text('LinkedIn Profile', 'question_1'), text('Website', 'question_2', false),
      choice('In which country do you currently work?', 'question_3', ['Canada', 'El Salvador', 'Mexico']),
      choice('Please indicate your nationality:', 'question_4', ['Canadian', 'Salvadoran'], true, 'multi_select'),
    ]
    const readiness = assessReadiness(form(questions), input())
    expect(readiness.answers.map((a) => [a.source, a.value])).toEqual([
      ['details', { kind: 'text', text: 'https://www.linkedin.com/in/ana' }],
      ['none', null],
      ['profile', { kind: 'choice', options: [{ label: 'El Salvador', value: '1' }] }],
      ['none', null],
    ])
    expect(readiness.blockers.map((b) => b.question.label)).toEqual(['Please indicate your nationality:'])
  })

  it('reuses a saved answer to the same question, text or choice', () => {
    const questions = [
      choice('How did you perform in mathematics at high school?', 'question_5', ['Cannot recall', 'Top 20% at school']),
      essay('Describe your experience with Linux', 'question_6'),
    ]
    const savedAnswers = [
      { questionKey: questionKey('How did you perform in mathematics at high school'), label: 'How did you perform in mathematics at high school?', answer: { kind: 'choice' as const, labels: ['Top 20% at school'] } },
      { questionKey: questionKey('Describe your experience with Linux.'), label: 'Describe your experience with Linux.', answer: { kind: 'text' as const, text: 'Ten years running Ubuntu servers.' } },
    ]
    const readiness = assessReadiness(form(questions), input({ savedAnswers }))
    expect(readiness.status).toBe('ready')
    expect(readiness.answers.map((a) => [a.source, a.value])).toEqual([
      ['saved', { kind: 'choice', options: [{ label: 'Top 20% at school', value: '1' }] }],
      ['saved', { kind: 'text', text: 'Ten years running Ubuntu servers.' }],
    ])
  })

  it('blocks a saved choice whose option this form does not offer, rather than picking another', () => {
    const question = choice('Do you require sponsorship?', 'question_7', ['Yes', 'No'])
    const savedAnswers = [{ questionKey: questionKey('Do you require sponsorship?'), label: 'Do you require sponsorship?', answer: { kind: 'choice' as const, labels: ['No, never'] } }]
    const readiness = assessReadiness(form([question]), input({ savedAnswers }))
    expect(readiness.blockers).toEqual([expect.objectContaining({ blocker: 'option_missing', source: 'none' })])
  })

  it('does not fill a single choice with several saved options, nor a choice with text', () => {
    const single = choice('Pick one', 'q8', ['A', 'B'])
    const free = choice('Pick another', 'q9', ['A', 'B'])
    const savedAnswers = [
      { questionKey: questionKey('Pick one'), label: 'Pick one', answer: { kind: 'choice' as const, labels: ['A', 'B'] } },
      { questionKey: questionKey('Pick another'), label: 'Pick another', answer: { kind: 'text' as const, text: 'A' } },
    ]
    const readiness = assessReadiness(form([single, free]), input({ savedAnswers }))
    expect(readiness.blockers.map((b) => b.blocker)).toEqual(['option_missing', 'unanswered'])
  })

  it('leaves an optional cover letter empty, and blocks a required one', () => {
    const coverLetter = (required: boolean): FormQuestion => ({
      label: 'Cover Letter', description: null, required, section: 'main',
      fields: [{ name: 'cover_letter', type: 'file', options: [] }, { name: 'cover_letter_text', type: 'textarea', options: [] }],
    })
    expect(assessReadiness(form([coverLetter(false)]), input()).status).toBe('ready')
    expect(assessReadiness(form([coverLetter(true)]), input()).blockers).toEqual([expect.objectContaining({ blocker: 'unanswered' })])
  })

  it('leaves fields the form fills itself to the form, without blocking', () => {
    const hidden = (label: string): FormQuestion => ({ label, description: null, required: true, section: 'location', fields: [{ name: label.toLowerCase(), type: 'hidden', options: [] }] })
    const location: FormQuestion = { label: 'Location', description: null, required: true, section: 'location', fields: [{ name: 'location', type: 'text', options: [] }] }
    const readiness = assessReadiness(form([hidden('Longitude'), hidden('Latitude'), location]), input())
    expect(readiness.status).toBe('ready')
    expect(readiness.answers.map((a) => [a.source, a.value])).toEqual([
      ['form', null], ['form', null], ['profile', { kind: 'text', text: 'San Salvador, El Salvador' }],
    ])
  })

  it('counts link questions as details, so the candidate fills them on the details form', () => {
    expect(standardField(text('LinkedIn Profile', 'question_1'))).toBe('details')
    expect(standardField(text('First Name', 'first_name'))).toBe('details')
    expect(standardField(resume)).toBe('resume')
    expect(standardField(essay('Why us?', 'question_2'))).toBeNull()
  })

  it('answers an optional compliance question only when the candidate saved an answer to it', () => {
    const veteran: FormQuestion = { ...choice('VeteranStatus', 'veteran_status', ["I don't wish to answer", 'I am not a protected veteran'], false), section: 'compliance' }
    expect(assessReadiness(form([veteran]), input()).answers[0]).toMatchObject({ source: 'none', blocker: null })
    const savedAnswers = [{ questionKey: questionKey('VeteranStatus'), label: 'VeteranStatus', answer: { kind: 'choice' as const, labels: ["I don't wish to answer"] } }]
    expect(assessReadiness(form([veteran]), input({ savedAnswers })).answers[0]).toMatchObject({ source: 'saved', value: { kind: 'choice', options: [{ label: "I don't wish to answer", value: '0' }] } })
  })
})
