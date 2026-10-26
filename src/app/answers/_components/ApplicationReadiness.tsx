import type { JobReadiness, QuestionAnswer, Suggestion } from '@/modules/application-answers'
import { AnswerValue } from './AnswerValue'
import { QuestionResponse } from './QuestionResponse'
import { SuggestedAnswer } from './SuggestedAnswer'
import styles from '../answers.module.css'

const SOURCE_LABELS = {
  details: 'Your details', resume: 'Resume', profile: 'Your profile', saved: 'Your answer',
  form: 'Application form', none: 'Answer',
}

function ReadinessQuestion({ answer, suggestion, back }: {
  readonly answer: QuestionAnswer
  readonly suggestion: Suggestion | undefined
  readonly back: string
}) {
  return (
    <article className={styles.question}>
      <h3>{answer.question.label}</h3>
      {answer.question.description !== null && <p className={styles.description}>{answer.question.description}</p>}
      {answer.question.required && <span className={styles.badge}>Required</span>}
      {answer.value !== null && <p className={styles.value}>{SOURCE_LABELS[answer.source]}: <AnswerValue value={answer.value} truncate /></p>}
      {answer.blocker !== null ? <>
        <p>{answer.blocker === 'option_missing' ? 'Your saved answer is not one of this form\'s options' : 'Needs your answer'}</p>
        {suggestion !== undefined && <SuggestedAnswer label={answer.question.label} suggestion={suggestion} back={back} />}
        <QuestionResponse question={answer.question} back={back} />
      </> : answer.value === null && <p className={styles.muted}>Optional, left empty</p>}
    </article>
  )
}

export function ApplicationReadiness({ readiness, back }: {
  readonly readiness: JobReadiness
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
          <ReadinessQuestion key={`${answer.questionKey}-${index}`} answer={answer} suggestion={readiness.suggestions.get(answer.questionKey)} back={back} />
        ))}
      </>}
    </section>
  )
}
