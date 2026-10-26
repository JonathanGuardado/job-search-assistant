import type { Suggestion } from '@/modules/application-answers'
import { acceptSuggestionAction } from '../actions'
import { AnswerValue } from './AnswerValue'
import styles from '../answers.module.css'

export function SuggestedAnswer({ label, suggestion, back }: {
  readonly label: string
  readonly suggestion: Suggestion
  readonly back: string
}) {
  return (
    <div className={styles.suggestion}>
      <p>You answered a similar question: “{suggestion.savedLabel}”: <AnswerValue value={suggestion.value} /></p>
      <form action={acceptSuggestionAction}>
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="label" value={label} />
        <input type="hidden" name="savedQuestionKey" value={suggestion.savedQuestionKey} />
        <button type="submit">Use this answer</button>
      </form>
    </div>
  )
}
