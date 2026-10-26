import type { OpenQuestion } from '@/modules/application-answers'
import { QuestionResponse } from './QuestionResponse'
import { SuggestedAnswer } from './SuggestedAnswer'
import styles from '../answers.module.css'

export function BlockingQuestion({ question }: { readonly question: OpenQuestion }) {
  return (
    <article className={styles.question}>
      <h3>{question.label}</h3>
      {question.question.description !== null && <p className={styles.description}>{question.question.description}</p>}
      <div className={styles.badges}>
        <span className={styles.badge}>Required</span>
        <span className={styles.badge}>Blocks {question.jobIds.length} {question.jobIds.length === 1 ? 'job' : 'jobs'}</span>
      </div>
      {question.answeredBy === 'saved_answer' && question.suggestion !== null
        && <SuggestedAnswer label={question.label} suggestion={question.suggestion} back="/answers" />}
      <QuestionResponse question={question.question} answeredBy={question.answeredBy} back="/answers" />
    </article>
  )
}
