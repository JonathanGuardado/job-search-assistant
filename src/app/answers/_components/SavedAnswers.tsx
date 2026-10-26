import type { JobReadiness, SavedAnswer } from '@/modules/application-answers'
import type { FormQuestion } from '@/modules/job-sources'
import { deleteAnswerAction } from '../actions'
import { AnswerForm } from './AnswerForm'
import { AnswerValue } from './AnswerValue'
import styles from '../answers.module.css'

export function SavedAnswers({ answers, readiness }: {
  readonly answers: readonly SavedAnswer[]
  readonly readiness: ReadonlyMap<string, JobReadiness>
}) {
  const questions = new Map([...readiness.values()].flatMap((job) => job.kind === 'assessed'
    ? job.readiness.answers.map((answer) => [answer.questionKey, answer.question] satisfies [string, FormQuestion]) : []))

  return <>
    {answers.length === 0 && <p className={styles.muted}>No saved answers yet.</p>}
    {answers.map((saved) => {
      // A choice answer can only be edited against a form that offers its options; a text answer needs no form.
      const question = questions.get(saved.questionKey) ?? (saved.answer.kind === 'text'
        ? { label: saved.label, description: null, required: true, section: 'main', fields: [{ name: 'answer', type: 'textarea', options: [] }] } satisfies FormQuestion
        : null)
      return <article key={saved.questionKey} className={styles.question}>
        <h3>{saved.label}</h3>
        <p className={styles.value}><AnswerValue value={saved.answer} /></p>
        {question === null
          ? <p className={styles.muted}>No form you can apply to asks this question now.</p>
          : <AnswerForm question={{ ...question, label: saved.label }} answer={saved.answer} back="/answers" />}
        <form action={deleteAnswerAction} className={styles.deleteForm}>
          <input type="hidden" name="back" value="/answers" />
          <input type="hidden" name="questionKey" value={saved.questionKey} />
          <button type="submit">Delete</button>
        </form>
      </article>
    })}
  </>
}
