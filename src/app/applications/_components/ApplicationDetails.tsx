import type { Result } from '@/lib/result'
import type { Application, ApplicationEvent } from '@/modules/applications'
import type { NormalizedPosting } from '@/modules/job-sources'
import { salaryToInput } from '@/modules/profiles'
import type { ResumeWithText } from '@/modules/resumes'
import { STATUS_LABELS } from './ApplicationStatus'
import styles from '../applications.module.css'

export function ApplicationDetails({ application, resume }: { readonly application: Application; readonly resume: ResumeWithText | null }) {
  const contact = application.contact
  return (
    <section className={styles.section} aria-labelledby="details-heading">
      <h2 id="details-heading">Application details</h2>
      <dl className={styles.details}>
        <dt>Applied on</dt><dd>{application.appliedOn}</dd>
        <dt>Resume</dt><dd>{resume === null ? 'Not one stored here' : `Version ${resume.version} · ${resume.filename}`}</dd>
        <dt>Salary asked</dt><dd>{application.salaryAsked === null ? 'Not stated' : `${salaryToInput(application.salaryAsked.amountMinor, application.salaryAsked.currency)} ${application.salaryAsked.currency}`}</dd>
        <dt>Contact</dt><dd>{contact === null ? 'Not stated' : <>
          {contact.name && <div>{contact.name}</div>}
          {contact.email && <div><a href={`mailto:${contact.email}`}>{contact.email}</a></div>}
          {contact.url && <div><a href={contact.url} target="_blank" rel="noopener noreferrer">{contact.url}</a></div>}
        </>}</dd>
        <dt>Source URL</dt><dd><a href={application.sourceUrl} target="_blank" rel="noopener noreferrer">{application.sourceUrl}</a></dd>
        <dt>Notes</dt><dd>{application.notes ?? 'Not stated'}</dd>
        <dt>Outcome reason</dt><dd>{application.outcomeReason ?? 'Not stated'}</dd>
      </dl>
    </section>
  )
}

export function ApplicationHistory({ events }: { readonly events: ApplicationEvent[] }) {
  return (
    <section className={styles.section} aria-labelledby="history-heading">
      <h2 id="history-heading">History</h2>
      <ol className={styles.history}>{events.map((event) => {
        const recordedOn = event.recordedAt.toISOString().slice(0, 10)
        return <li key={event.id}>
          <strong>{event.occurredOn} · {event.fromStatus === null ? 'Logged as applied' : `${STATUS_LABELS[event.fromStatus]} → ${STATUS_LABELS[event.toStatus]}`}</strong>
          {event.note !== null && <p>{event.note}</p>}
          {recordedOn !== event.occurredOn && <p className={styles.muted}>recorded {recordedOn}</p>}
        </li>
      })}</ol>
    </section>
  )
}

export function AppliedPosting({ posting, closed }: { readonly posting: Result<NormalizedPosting>; readonly closed: boolean }) {
  return (
    <section className={styles.section} aria-labelledby="posting-heading">
      <h2 id="posting-heading">The posting as you applied to it</h2>
      {!posting.ok ? <p role="alert">{posting.error.message}</p> : <>
        {closed && <p>This posting is no longer listed. This is the version you applied to.</p>}
        <h3>{posting.value.job.title}</h3>
        <p className={styles.muted}>{posting.value.job.locationText ?? 'Location not stated'}</p>
        <pre className={styles.description}>{posting.value.job.description}</pre>
      </>}
    </section>
  )
}
