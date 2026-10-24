import type { Application } from '@/modules/applications'
import { CURRENCIES, salaryToInput } from '@/modules/profiles'
import type { ResumeSummary } from '@/modules/resumes'
import styles from '../applications.module.css'

export function ApplicationFields({ application, resumes, defaultCurrency, applyUrl }: {
  readonly application: Application | null
  readonly resumes: ResumeSummary[]
  readonly defaultCurrency: string
  readonly applyUrl: string
}) {
  const today = new Date().toISOString().slice(0, 10)
  const currency = application?.salaryAsked?.currency ?? defaultCurrency
  return (
    <div className={styles.fields}>
      <label>Applied on<input name="appliedOn" type="date" required max={today} defaultValue={application?.appliedOn ?? today} /></label>
      <label>Resume version sent
        <select name="resumeId" defaultValue={application === null ? resumes[0]?.id ?? '' : application.resumeId ?? ''}>
          {resumes.map((resume) => <option key={resume.id} value={resume.id}>Version {resume.version} · {resume.filename}</option>)}
          <option value="">Not one stored here</option>
        </select>
      </label>
      <label>Salary asked<input name="salaryAmount" type="text" inputMode="decimal" defaultValue={salaryToInput(application?.salaryAsked?.amountMinor ?? null, currency)} /></label>
      <label>Currency<select name="salaryCurrency" defaultValue={currency}>{CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
      <label>Contact name<input name="contactName" type="text" maxLength={200} defaultValue={application?.contact?.name ?? ''} /></label>
      <label>Contact email<input name="contactEmail" type="text" maxLength={320} defaultValue={application?.contact?.email ?? ''} /></label>
      <label>Contact URL<input name="contactUrl" type="text" maxLength={2000} defaultValue={application?.contact?.url ?? ''} /></label>
      <label>Source URL<input name="sourceUrl" type="text" maxLength={2000} placeholder={applyUrl} defaultValue={application?.sourceUrl ?? ''} readOnly={application !== null} />
        <span className={styles.hint}>{application === null ? "Leave empty to use the job’s application link." : 'Recorded when the application was logged.'}</span>
      </label>
      <label className={styles.fullWidth}>Notes<textarea name="notes" rows={4} maxLength={5000} defaultValue={application?.notes ?? ''} /></label>
      {application !== null && <label className={styles.fullWidth}>Outcome reason<textarea name="outcomeReason" rows={3} maxLength={1000} defaultValue={application.outcomeReason ?? ''} /></label>}
    </div>
  )
}
