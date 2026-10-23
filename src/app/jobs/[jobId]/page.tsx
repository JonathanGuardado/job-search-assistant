import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { getAssessment, reviewGroup } from '@/modules/eligibility'
import { getJob, getJobUserState } from '@/modules/jobs'
import { getMatchCard } from '@/modules/matching'
import { EligibilityDetails } from '../_components/EligibilityDetails'
import { JobActions } from '../_components/JobActions'
import { MatchDetails } from '../_components/MatchDetails'
import { formatLocation, formatSalary } from '../_lib/format'
import styles from '../jobs.module.css'

export const dynamic = 'force-dynamic'

export default async function JobPage({ params, searchParams }: {
  readonly params: { readonly jobId: string }
  readonly searchParams: Record<string, string | string[] | undefined>
}) {
  const parsed = z.uuid().safeParse(params.jobId)
  if (!parsed.success) notFound()
  const jobId = parsed.data
  const error = z.string().catch('').parse(searchParams.error)
  const db = getDb()
  const assessment = await withTenant(db, DEV_USER.id, (scope) => getAssessment(scope, jobId))
  if (assessment === null) notFound()
  const result = await getJob(db, jobId)
  if (!result.ok) notFound()
  const job = result.value
  const state = await withTenant(db, DEV_USER.id, (scope) => getJobUserState(scope, jobId))
  const userState = state.ok ? state.value : null
  const card = await getMatchCard(db, DEV_USER.id, jobId)
  const tab = userState?.state === 'ignored' ? 'hidden' : reviewGroup(assessment)

  return (
    <main className={styles.page}>
      <nav><Link href="/jobs">← Jobs</Link></nav>
      <header>
        <p className={styles.eyebrow}>{job.companyName}</p>
        <h1>{job.title}</h1>
        <p>{formatLocation(job.locationText)}</p>
        <p>{formatSalary(job.salary) ?? 'Salary not stated'}</p>
        {job.salaryQuote !== null && <div><p>From the posting</p><blockquote>“{job.salaryQuote}”</blockquote></div>}
        <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">View original posting</a>
      </header>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.badges}>
        {userState?.state === 'saved' && <span className={styles.badge}>Saved</span>}
        {assessment.userOverride !== null && <span className={styles.badge}>Your verdict</span>}
      </div>
      <JobActions assessment={assessment} userState={userState} tab={tab} back={`/jobs/${jobId}`} offerReason />
      <EligibilityDetails assessment={assessment} />
      <MatchDetails card={card} />
      <section className={styles.section} aria-labelledby="description-heading">
        <h2 id="description-heading">Full description</h2>
        <div className={styles.description}>{job.description}</div>
      </section>
    </main>
  )
}
