import type { ApplicationForm, FormField, FormQuestion } from '@/modules/job-sources'

/*
 * Whether a job's application form could be filled from what the candidate has given, and
 * with what (decision 0013). Pure and deterministic: no model reads or writes an answer here.
 * Every value comes from the candidate's details, their newest resume, their profile, or an
 * answer they saved; a required question with none of those blocks the form.
 */

/** The same question however it is cased, spaced or punctuated at the end. */
export function questionKey(label: string): string {
  return label.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s*:?.!]+$/, '')
}

export type SavedAnswerValue = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'choice'; readonly labels: readonly string[] }

export type ReadinessInput = {
  readonly details: {
    readonly firstName: string; readonly lastName: string; readonly email: string; readonly phone: string | null
    readonly linkedinUrl: string | null; readonly githubUrl: string | null; readonly websiteUrl: string | null
  } | null
  /** The resume a form's resume field is filled with: the newest version, unless the candidate chose another. */
  readonly resume: { readonly id: string; readonly label: string } | null
  readonly profile: { readonly country: string; readonly city: string } | null
  readonly savedAnswers: readonly { readonly questionKey: string; readonly label: string; readonly answer: SavedAnswerValue }[]
}

export type FilledValue =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'file'; readonly resumeId: string; readonly label: string }
  | { readonly kind: 'choice'; readonly options: readonly { readonly label: string; readonly value: string }[] }

export type QuestionAnswer = {
  readonly question: FormQuestion
  readonly questionKey: string
  /** form: a field the form fills itself (a location widget's coordinates). */
  readonly source: 'details' | 'resume' | 'profile' | 'saved' | 'form' | 'none'
  /** The form field the value goes in, null when there is no value. */
  readonly field: string | null
  readonly value: FilledValue | null
  /** Why a required question is unfilled; null when it is filled, or optional. */
  readonly blocker: 'unanswered' | 'option_missing' | null
}

export type Readiness = {
  readonly status: 'ready' | 'blocked'
  readonly answers: readonly QuestionAnswer[]
  readonly blockers: readonly QuestionAnswer[]
}

type Fill = { readonly source: QuestionAnswer['source']; readonly field: string; readonly value: FilledValue }
type Attempt = Fill | 'option_missing' | null

const DETAIL_FIELDS: Readonly<Record<string, 'firstName' | 'lastName' | 'email' | 'phone'>> = {
  first_name: 'firstName', last_name: 'lastName', email: 'email', phone: 'phone',
}
const LINK_RULES: ReadonlyArray<readonly [RegExp, 'linkedinUrl' | 'githubUrl' | 'websiteUrl']> = [
  [/linked\s*in/i, 'linkedinUrl'], [/git\s*hub/i, 'githubUrl'], [/\b(website|portfolio|personal site)\b/i, 'websiteUrl'],
]
/** Where the candidate lives, not their citizenship or papers: those are theirs to state. */
const RESIDENCE_COUNTRY = /\bcountry\b/i
const NOT_RESIDENCE = /citizen|nationalit|passport|authori[sz]|visa|sponsor|birth/i
const CITY_LABEL = /^(current )?(location|city)\b/i

const regionNames = new Intl.DisplayNames('en', { type: 'region' })
const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const textField = (q: FormQuestion) => q.fields.find((f) => f.type === 'text' || f.type === 'textarea')
const choiceField = (q: FormQuestion) => q.fields.find((f) => f.type === 'single_select' || f.type === 'multi_select')

/** Whether a question is one of the standard fields answered from the details form or the resume, not by a saved answer. */
export function standardField(question: FormQuestion): 'details' | 'resume' | null {
  if (question.fields.some((f) => DETAIL_FIELDS[f.name] !== undefined)) return 'details'
  if (textField(question) && LINK_RULES.some(([pattern]) => pattern.test(question.label))) return 'details'
  return question.fields.some((f) => f.name === 'resume' && f.type === 'file') ? 'resume' : null
}

function fromDetailsOrResume(question: FormQuestion, input: ReadinessInput): Attempt {
  for (const field of question.fields) {
    const detail = DETAIL_FIELDS[field.name]
    if (detail !== undefined) {
      const text = input.details?.[detail]
      return text ? { source: 'details', field: field.name, value: { kind: 'text', text } } : null
    }
    if (field.name === 'resume' && field.type === 'file') {
      return input.resume ? { source: 'resume', field: field.name, value: { kind: 'file', resumeId: input.resume.id, label: input.resume.label } } : null
    }
  }
  return null
}

function fromSaved(question: FormQuestion, key: string, input: ReadinessInput): Attempt {
  const saved = input.savedAnswers.find((s) => s.questionKey === key)
  if (!saved) return null
  if (saved.answer.kind === 'text') {
    const field = textField(question)
    return field ? { source: 'saved', field: field.name, value: { kind: 'text', text: saved.answer.text } } : null
  }
  const field = choiceField(question)
  if (!field) return null
  return choose(field, saved.answer.labels, 'saved')
}

/** The options a saved choice names, all of which this form must offer: never a different one. */
function choose(field: FormField, labels: readonly string[], source: Fill['source']): Attempt {
  if (labels.length === 0 || (field.type === 'single_select' && labels.length !== 1)) return 'option_missing'
  const options = labels.map((label) => field.options.find((o) => sameLabel(o.label, label)))
  if (options.some((o) => o === undefined)) return 'option_missing'
  return { source, field: field.name, value: { kind: 'choice', options: options.flatMap((o) => (o ? [o] : [])) } }
}

function fromProfile(question: FormQuestion, input: ReadinessInput): Attempt {
  const link = LINK_RULES.find(([pattern]) => pattern.test(question.label))
  const text = textField(question)
  if (link && text) {
    const url = input.details?.[link[1]]
    return url ? { source: 'details', field: text.name, value: { kind: 'text', text: url } } : null
  }
  if (!input.profile) return null
  const country = regionNames.of(input.profile.country) ?? input.profile.country
  const select = question.fields.find((f) => f.type === 'single_select')
  if (select && RESIDENCE_COUNTRY.test(question.label) && !NOT_RESIDENCE.test(question.label)) {
    const option = select.options.find((o) => sameLabel(o.label, country))
    return option ? { source: 'profile', field: select.name, value: { kind: 'choice', options: [option] } } : null
  }
  if (text && (question.section === 'location' || CITY_LABEL.test(question.label))) {
    return { source: 'profile', field: text.name, value: { kind: 'text', text: `${input.profile.city}, ${country}` } }
  }
  return null
}

function answer(question: FormQuestion, input: ReadinessInput): QuestionAnswer {
  const key = questionKey(question.label)
  if (question.fields.every((f) => f.type === 'hidden')) {
    return { question, questionKey: key, source: 'form', field: null, value: null, blocker: null }
  }
  // Standard fields first, then the candidate's own answer to this question, then the profile.
  let missing = false
  for (const attempt of [fromDetailsOrResume(question, input), fromSaved(question, key, input), fromProfile(question, input)]) {
    if (attempt === 'option_missing') missing = true
    else if (attempt !== null) return { question, questionKey: key, ...attempt, blocker: null }
  }
  const blocker = !question.required ? null : missing ? 'option_missing' : 'unanswered'
  return { question, questionKey: key, source: 'none', field: null, value: null, blocker }
}

export function assessReadiness(form: ApplicationForm, input: ReadinessInput): Readiness {
  const answers = form.questions.map((question) => answer(question, input))
  const blockers = answers.filter((a) => a.blocker !== null)
  return { status: blockers.length === 0 ? 'ready' : 'blocked', answers, blockers }
}
