import type { SavedAnswerValue } from '@/modules/application-answers'
import type { FormQuestion } from '@/modules/job-sources'
import { acceptDraftAction, saveAnswerAction } from '../actions'
import styles from '../answers.module.css'

export function AnswerForm({ question, back, answer, draftId, jobId }: {
  readonly question: FormQuestion
  readonly back: string
  readonly answer?: SavedAnswerValue
  readonly draftId?: string
  readonly jobId?: string
}) {
  const field = question.fields.find((field) => field.type === 'single_select')
    ?? question.fields.find((field) => field.type === 'multi_select')
    ?? question.fields.find((field) => field.type === 'textarea')
    ?? question.fields.find((field) => field.type === 'text')
  if (!field) return null
  const isChoice = field.type === 'single_select' || field.type === 'multi_select'
  const selected = answer?.kind === 'choice' ? answer.labels : []
  const text = answer?.kind === 'text' ? answer.text : ''

  return (
    <form action={draftId === undefined ? saveAnswerAction : acceptDraftAction} className={styles.answerForm}>
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="label" value={question.label} />
      <input type="hidden" name="kind" value={isChoice ? 'choice' : 'text'} />
      {draftId !== undefined && <input type="hidden" name="draftId" value={draftId} />}
      {jobId !== undefined && <input type="hidden" name="jobId" value={jobId} />}
      <fieldset className={styles.answerFields}>
        <legend>Your answer to {question.label}</legend>
        {isChoice ? field.options.map((option) => (
          <label key={option.value} className={styles.option}>
            <input type={field.type === 'single_select' ? 'radio' : 'checkbox'} name="option" value={option.label}
              defaultChecked={selected.some((label) => label.trim().toLowerCase() === option.label.trim().toLowerCase())} />
            <span>{option.label}</span>
          </label>
        )) : <label className={styles.textField}>
          Answer
          {field.type === 'textarea'
            ? <textarea name="text" rows={5} maxLength={10_000} defaultValue={text} />
            : <input type="text" name="text" maxLength={10_000} defaultValue={text} />}
        </label>}
      </fieldset>
      <button type="submit">{draftId === undefined ? 'Save answer' : 'Use this draft'}</button>
    </form>
  )
}
