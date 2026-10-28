import type { AnswerDraft, DraftMethod, NeverDrafted } from '@/modules/application-answers'
import type { FormQuestion } from '@/modules/job-sources'
import { draftNowAction } from '../actions'
import { AnswerForm } from './AnswerForm'
import styles from '../answers.module.css'

const OWNER_MESSAGES: Record<NeverDrafted, string> = {
  consent: 'Only you can answer this: it records your own agreement.',
  demographic: 'Only you can answer this: the assistant never infers how you describe yourself.',
  no_record: 'Only you can answer this: your profile and career record do not hold it.',
  owner_only: 'Only you can answer this: it asks about your own circumstances or preferences.',
}

const METHOD_LABELS: Record<DraftMethod, string> = {
  profile: 'Drafted from your profile',
  experience: 'Drafted from your confirmed career items',
  motivation: "Drafted from your career items and this job's posting",
}

export function DraftOrMarker({ question, questionKey, draft, neverDrafted, back }: {
  readonly question: FormQuestion
  readonly questionKey: string
  readonly draft: AnswerDraft | null
  readonly neverDrafted: NeverDrafted | null
  readonly back: string
}) {
  if (neverDrafted !== null) return <p className={styles.muted}>{OWNER_MESSAGES[neverDrafted]}</p>
  if (draft === null) return <div className={styles.draftMarker}>
    <p className={styles.muted}>Not drafted yet.</p>
    <form action={draftNowAction}>
      <input type="hidden" name="questionKey" value={questionKey} />
      <input type="hidden" name="back" value={back} />
      <button type="submit">Draft now</button>
    </form>
  </div>
  if (draft.status === 'no_basis') return <p className={styles.muted}>No draft: {draft.reason}</p>
  if (draft.status === 'rejected') return <div className={styles.draftMarker}>
    <p>No draft: the drafts used details your career record does not contain.</p>
    <details className={styles.disclosure}>
      <summary>Why</summary>
      <p className={styles.description}>{draft.reason}</p>
    </details>
  </div>
  return <div className={styles.draft}>
    <h4>Draft</h4>
    <p>{METHOD_LABELS[draft.method]}</p>
    <p>Based on</p>
    <ul className={styles.basis}>
      {draft.basis.facts.map((fact, index) => <li key={index}>{fact}</li>)}
    </ul>
    {draft.answer !== null && <AnswerForm question={question} back={back} answer={draft.answer} draftId={draft.id} />}
    <p className={styles.muted}>You can edit it first.</p>
  </div>
}
