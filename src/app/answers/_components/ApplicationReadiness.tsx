import { standardField, type AnswerDraft, type JobReadiness, type NeverDrafted, type QuestionAnswer, type Suggestion } from '@/modules/application-answers'
import { AnswerValue } from './AnswerValue'
import { DraftOrMarker } from './DraftOrMarker'
import { QuestionResponse } from './QuestionResponse'
import { SuggestedAnswer } from './SuggestedAnswer'
import styles from '../answers.module.css'

const SOURCE_LABELS = {
  details: 'Your details', resume: 'Resume', profile: 'Your profile', saved: 'Your answer',
  form: 'Application form', none: 'Answer',
}

function ReadinessQuestion({ answer, suggestion, draft, ownerOnly, perJob, jobId, back }: {
  readonly answer: QuestionAnswer
  readonly suggestion: Suggestion | undefined
  readonly draft: AnswerDraft | null
  readonly ownerOnly: NeverDrafted | null
  readonly perJob: boolean
  readonly jobId: string
  readonly back: string
}) {
  // Questions filled from your details or resume are never drafted: they are answered in settings.
  const drafted = standardField(answer.question) === null
  return (
    <article className={styles.question}>
      <h3>{answer.question.label}</h3>
      {answer.question.description !== null && <p className={styles.description}>{answer.question.description}</p>}
      {answer.question.required && <span className={styles.badge}>Required</span>}
      {answer.value !== null && <p className={styles.value}>{SOURCE_LABELS[answer.source]}: <AnswerValue value={answer.value} truncate /></p>}
      {answer.blocker !== null ? <>
        <p>{answer.blocker === 'option_missing' ? 'Your saved answer is not one of this form\'s options' : 'Needs your answer'}</p>
        {drafted && <DraftOrMarker question={answer.question} questionKey={answer.questionKey} draft={draft}
          neverDrafted={ownerOnly} back={back} />}
        {suggestion !== undefined && <SuggestedAnswer label={answer.question.label} suggestion={suggestion} back={back} />}
        <QuestionResponse question={answer.question} back={back}
          hasDraft={drafted && ownerOnly === null && draft?.status === 'drafted'}
          {...(perJob || draft?.jobId ? { jobId } : {})} />
      </> : answer.value === null && <p className={styles.muted}>Optional, left empty</p>}
    </article>
  )
}

export function ApplicationReadiness({ readiness, jobId, back }: {
  readonly readiness: JobReadiness
  readonly jobId: string
  readonly back: string
}) {
  return (
    <section className={styles.section} aria-labelledby="readiness-heading">
      <h2 id="readiness-heading">Application readiness</h2>
      {readiness.kind === 'unsupported' && <p>This job's site has no application form the assistant can read. You will apply yourself.</p>}
      {readiness.kind === 'not_fetched' && <p>The application form has not been fetched yet.</p>}
      {readiness.kind === 'assessed' && <>
        <p>{readiness.readiness.status === 'ready' ? 'Ready to send'
          : `Blocked by ${readiness.readiness.blockers.length} ${readiness.readiness.blockers.length === 1 ? 'question' : 'questions'}`}</p>
        {readiness.readiness.answers.filter((answer) => answer.source !== 'form').map((answer, index) => (
          <ReadinessQuestion key={`${answer.questionKey}-${index}`} answer={answer} suggestion={readiness.suggestions.get(answer.questionKey)}
            draft={readiness.drafts.get(answer.questionKey) ?? null} ownerOnly={readiness.neverDrafted.get(answer.questionKey) ?? null}
            perJob={readiness.perJob.has(answer.questionKey)} jobId={jobId} back={back} />
        ))}
      </>}
    </section>
  )
}
