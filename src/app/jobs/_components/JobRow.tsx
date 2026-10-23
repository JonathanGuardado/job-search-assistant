import Link from 'next/link'
import { effectiveVerdict } from '@/modules/eligibility'
import { summarizeMatch } from '@/modules/matching'
import { formatLocation, formatSalary } from '../_lib/format'
import type { JobTab, Row } from '../_lib/job-list'
import { JobActions } from './JobActions'
import styles from '../jobs.module.css'

function MatchPreview({ row }: { readonly row: Row }) {
  if (row.match !== null) {
    const summary = summarizeMatch(row.match)
    return <>
      {summary.requiredTotal > 0 && <p>{summary.requiredShown} of {summary.requiredTotal} required skills shown</p>}
      {summary.topConcern !== null && <p>{summary.topConcern}</p>}
    </>
  }
  // A job the user marked as one they can take shows the match it is waiting for, not the engine's old reason.
  if (effectiveVerdict(row.assessment) === 'eligible') return <p>Not matched yet.</p>
  const { verdict, reasons } = row.assessment
  const reason = verdict === 'not_eligible' && 'reason' in reasons ? reasons.reason
    : verdict === 'needs_review' && 'openQuestions' in reasons ? reasons.openQuestions.at(0) : undefined
  return <p>{reason ?? 'Not matched yet.'}</p>
}

export function JobRow({ row, tab, back }: { readonly row: Row; readonly tab: JobTab; readonly back: string }) {
  return (
    <article className={styles.section}>
      <p className={styles.company}>{row.job.companyName}</p>
      <h2><Link href={`/jobs/${row.job.id}`}>{row.job.title}</Link></h2>
      <p className={styles.muted}>{formatLocation(row.job.locationText)}</p>
      <p>{formatSalary(row.job.salary) ?? 'Salary not stated'}</p>
      <MatchPreview row={row} />
      <div className={styles.badges}>
        {row.userState?.state === 'saved' && <span className={styles.badge}>Saved</span>}
        {row.assessment.userOverride !== null && <span className={styles.badge}>Your verdict</span>}
      </div>
      <JobActions assessment={row.assessment} userState={row.userState} tab={tab} back={back} />
    </article>
  )
}
