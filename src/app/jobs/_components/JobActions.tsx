import type { ReactNode } from 'react'
import type { Assessment } from '@/modules/eligibility'
import type { JobUserState } from '@/modules/jobs'
import { hideJob, markEligible, saveJob, undoVerdict, unhideJob, unsaveJob } from '../actions'
import type { JobTab } from '../_lib/job-list'
import styles from '../jobs.module.css'

function ActionForm({ action, jobId, back, label, children }: {
  readonly action: (form: FormData) => Promise<void>
  readonly jobId: string
  readonly back: string
  readonly label: string
  readonly children?: ReactNode
}) {
  return (
    <form action={action}>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="back" value={back} />
      {children}
      <button type="submit">{label}</button>
    </form>
  )
}

export function JobActions({ assessment, userState, tab, back, offerReason = false }: {
  readonly assessment: Assessment
  readonly userState: JobUserState | null
  readonly tab: JobTab
  readonly back: string
  readonly offerReason?: boolean
}) {
  const jobId = assessment.jobId
  const saved = userState?.state === 'saved'
  return (
    <div className={styles.actions}>
      <ActionForm action={saved ? unsaveJob : saveJob} jobId={jobId} back={back} label={saved ? 'Unsave' : 'Save'} />
      <ActionForm action={tab === 'hidden' ? unhideJob : hideJob} jobId={jobId} back={back} label={tab === 'hidden' ? 'Unhide' : 'Hide'} />
      {tab !== 'can_apply' && (
        <ActionForm action={markEligible} jobId={jobId} back={back} label="I can take this">
          {offerReason && <label className={styles.reason}>Reason (optional)<input type="text" name="reason" maxLength={500} /></label>}
        </ActionForm>
      )}
      {assessment.userOverride !== null && <ActionForm action={undoVerdict} jobId={jobId} back={back} label="Undo my verdict" />}
    </div>
  )
}
