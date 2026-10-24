import type { Application } from '@/modules/applications'
import { APPLICATION_STATUSES } from '@/modules/applications'
import type { ResumeSummary } from '@/modules/resumes'
import { changeApplicationStatus, editApplication, logApplication } from '../actions'
import { ApplicationFields } from './ApplicationFields'
import { STATUS_LABELS } from './ApplicationStatus'
import styles from '../applications.module.css'

export function LogApplicationForm({ jobId, applyUrl, resumes, defaultCurrency }: {
  readonly jobId: string
  readonly applyUrl: string
  readonly resumes: ResumeSummary[]
  readonly defaultCurrency: string
}) {
  return (
    <form action={logApplication} className={styles.form}>
      <input type="hidden" name="jobId" value={jobId} />
      <ApplicationFields application={null} resumes={resumes} defaultCurrency={defaultCurrency} applyUrl={applyUrl} />
      <button type="submit" className={styles.primary}>Mark applied</button>
    </form>
  )
}

export function EditApplicationForm({ application, resumes, defaultCurrency }: {
  readonly application: Application
  readonly resumes: ResumeSummary[]
  readonly defaultCurrency: string
}) {
  return (
    <form action={editApplication} className={styles.form}>
      <input type="hidden" name="applicationId" value={application.id} />
      <ApplicationFields application={application} resumes={resumes} defaultCurrency={defaultCurrency} applyUrl={application.sourceUrl} />
      <button type="submit" className={styles.primary}>Save details</button>
    </form>
  )
}

export function ChangeStageForm({ application }: { readonly application: Application }) {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <form action={changeApplicationStatus} className={styles.form}>
      <input type="hidden" name="applicationId" value={application.id} />
      <div className={styles.fields}>
        <label>New stage<select name="to" required>{APPLICATION_STATUSES.filter((status) => status !== application.status).map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label>
        <label>Occurred on<input name="occurredOn" type="date" required min={application.appliedOn} max={today} defaultValue={today} /></label>
        <label className={styles.fullWidth}>Note (optional)<textarea name="note" rows={3} maxLength={1000} /></label>
      </div>
      <button type="submit" className={styles.primary}>Change stage</button>
    </form>
  )
}
