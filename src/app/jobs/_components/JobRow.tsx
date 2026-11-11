import Link from 'next/link'
import { effectiveVerdict } from '@/modules/eligibility'
import { summarizeMatch } from '@/modules/matching'
import { formatLocation, formatPosted, formatSalary } from '../_lib/format'
import type { JobTab, Row } from '../_lib/job-list'
import { CompanyMark } from './CompanyMark'
import { CashIcon, PinIcon } from './icons'
import { JobActions } from './JobActions'
import styles from '../jobs.module.css'

/**
 * What the card says about fit: how much of the match's required skills the record shows, and one line of text.
 * A job the user can take shows its worst concern; any other job shows why the engine is unsure or said no.
 */
function fitOf(row: Row) {
  const summary = row.match === null ? null : summarizeMatch(row.match)
  const share = summary === null || summary.requiredTotal === 0 ? null : summary.requiredShown / summary.requiredTotal
  const tone = share === null ? styles.neutral : share === 1 ? styles.ok : share >= 0.5 ? styles.warn : styles.bad
  const eligible = effectiveVerdict(row.assessment) === 'eligible'
  const pill = summary !== null && share !== null
    ? <span className={`${styles.pill} ${tone}`}>{summary.requiredShown}/{summary.requiredTotal} required skills</span>
    // A job the user marked as one they can take shows the match it is waiting for.
    : eligible && summary === null ? <span className={`${styles.pill} ${styles.neutral}`}>Not matched yet</span> : null
  const text = (line: string | null | undefined, toneClass: string | undefined) =>
    line ? <p className={`${styles.signal} ${toneClass}`}>{line}</p> : null
  if (eligible) return { pill, text: text(summary?.topConcern, styles.warn) }
  const { verdict, reasons } = row.assessment
  if (verdict === 'not_eligible' && 'reason' in reasons) return { pill, text: text(reasons.reason, styles.bad) }
  return { pill, text: text(verdict === 'needs_review' && 'openQuestions' in reasons ? reasons.openQuestions.at(0) : null, styles.warn) }
}

export function JobRow({ row, tab, back, readyToSend, now }: {
  readonly row: Row; readonly tab: JobTab; readonly back: string; readonly readyToSend: boolean; readonly now: Date
}) {
  const { job } = row
  const href = `/jobs/${job.id}?${new URLSearchParams({ from: `${back}#job-${job.id}` })}`
  const posted = formatPosted(job.postedAt, now)
  const salary = formatSalary(job.salary)
  const fit = fitOf(row)
  return (
    <article id={`job-${job.id}`} className={styles.card}>
      <CompanyMark name={job.companyName} />
      <div>
        <div className={styles.cardTop}>
          <span className={styles.company}>{job.companyName}</span>
          {posted !== null && <span>· {posted}</span>}
        </div>
        <h2 className={styles.cardTitle}><Link href={href}>{job.title}</Link></h2>
        <ul className={styles.meta}>
          <li><PinIcon />{formatLocation(job.locationText)}</li>
          {salary !== null && <li><CashIcon />{salary}</li>}
        </ul>
        <div className={styles.signals}>
          {fit.pill}
          {readyToSend && <span className={`${styles.pill} ${styles.ok}`}>Ready to send</span>}
          {row.userState?.state === 'saved' && <span className={styles.pill}>Saved</span>}
          {row.userState?.state === 'applied' && <span className={styles.pill}>Applied</span>}
          {row.assessment.userOverride !== null && <span className={styles.pill}>Your verdict</span>}
        </div>
        {fit.text}
      </div>
      <div className={styles.cardActions}>
        <JobActions assessment={row.assessment} userState={row.userState} tab={tab} back={back} />
      </div>
    </article>
  )
}
