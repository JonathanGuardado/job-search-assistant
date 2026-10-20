'use client'

import { deleteResumeAction } from '../actions'
import styles from '../resumes.module.css'

export function DeleteResumeButton({ resumeId, filename, isParsing }: {
  readonly resumeId: string
  readonly filename: string
  readonly isParsing: boolean
}) {
  return (
    <form
      action={deleteResumeAction}
      onSubmit={(event) => {
        if (!window.confirm(`Delete "${filename}"? Its unconfirmed entries will be removed. Confirmed career items will be kept.`)) {
          event.preventDefault()
        }
      }}
    >
      <input type="hidden" name="resumeId" value={resumeId} />
      <button className={styles.dangerButton} type="submit" disabled={isParsing} title={isParsing ? 'Wait for parsing to finish' : undefined}>
        Delete
      </button>
    </form>
  )
}
