import { describe, expect, it } from 'vitest'
import type { FormQuestion } from '@/modules/job-sources'
import { asksOwnWords, neverDrafted } from './never-drafted.js'

const question = (label: string, section: FormQuestion['section'] = 'main'): FormQuestion => ({
  label, description: null, required: true, section, fields: [{ name: 'q', type: 'single_select', options: [{ label: 'Yes', value: '1' }] }],
})

describe('questions the assistant never drafts', () => {
  it.each([
    "By selecting 'I acknowledge' and submitting this application, you confirm that you have read Elastic's Privacy Statement",
    "Please confirm that you have read and agree to Canonical's Recruitment Privacy Notice and Personal Data Consent",
    'I certify that the information provided in this application is true and correct to the best of my knowledge',
    'I understand my application will be processed in accordance with Datadog’s Candidate Privacy Notice',
    'During this application process I agree to use only my own words. I understand that plagiarism will lead to disqualification',
    'Do you consent to Elastic processing your personal data for the purposes of this application?',
    'To ensure we can focus fully on our conversation, we use BrightHire to record and transcribe interviews. Do you agree?',
  ])('a consent or attestation: %s', (label) => {
    expect(neverDrafted(question(label))).toBe('consent')
  })

  it.each([
    'Which gender do you identify as?',
    'Please indicate your race or ethnicity:',
    'Gender Pronouns (She/Her/Hers, He/Him/His, They/Them/Theirs, etc.)',
    'Are you a protected veteran?',
    'Do you have a disability?',
    'What is your sexual orientation?',
  ])('a demographic question: %s', (label) => {
    expect(neverDrafted(question(label))).toBe('demographic')
  })

  it('anything in the form\'s own demographic or compliance sections', () => {
    expect(neverDrafted(question('Please select', 'demographic'))).toBe('demographic')
    expect(neverDrafted(question('Please select', 'compliance'))).toBe('demographic')
  })

  it.each([
    'How did you perform in mathematics at high school?',
    'How did you perform in your native language at high school?',
    "What was your bachelor's university degree result, or expected result if you have not yet graduated?",
    'What was your GPA?',
  ])('a school result no record holds: %s', (label) => {
    expect(neverDrafted(question(label))).toBe('no_record')
  })

  it.each([
    'How should we communicate with you?',
    'What is your preferred method of contact?',
    'Are you subject to any employment agreements and/or post-employment restrictions with your current employer or a past employer?',
    'Are you bound by a non-compete agreement?',
    'Are you comfortable using your own computer running Ubuntu?',
    'Are you comfortable using your own device?',
    'Are you willing to use your own computer for work?',
  ])('a preference or obligation only the owner knows: %s', (label) => {
    expect(neverDrafted(question(label))).toBe('no_record')
  })

  it.each([
    'What is your experience with search and vector search systems?',
    "Will you require Elastic's sponsorship to continue or extend your work authorization status?",
    'Have you ever been employed by Stripe or a Stripe affiliate?',
    'Why do you want to join Clara, and why are you the right fit for this specific role?',
    'What is your current country of residence?',
    'What time zone are you in?',
    'Describe a recent case where you drove significant performance improvement in a system',
  ])('lets everything else through to be read: %s', (label) => {
    expect(neverDrafted(question(label))).toBeNull()
  })
})

describe('forms that ask for the candidate\'s own words', () => {
  it.each([
    'During this application process I agree to use only my own words. I understand that plagiarism, the use of AI or other generated content will disqualify my application.',
    'Applications containing AI-generated answers will not be considered.',
    'Please do not use ChatGPT or other AI tools to answer these questions.',
  ])('is recognised: %s', (label) => {
    expect(asksOwnWords(question(label))).toBe(true)
  })

  it.each([
    'Describe your experience with AI and machine learning systems.',
    'What is your experience with generative AI tools in your daily work?',
    'Do you consent to Elastic processing your personal data for the purposes of this application?',
  ])('is not read into questions about AI or other consents: %s', (label) => {
    expect(asksOwnWords(question(label))).toBe(false)
  })
})
