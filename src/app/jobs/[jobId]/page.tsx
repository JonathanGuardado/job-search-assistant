import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { readinessForJobs } from '@/modules/application-answers'
import { getApplicationForJob } from '@/modules/applications'
import { expireFills, latestFillForJob } from '@/modules/automation'
import { getAssessment, reviewGroup } from '@/modules/eligibility'
import { getJob, getJobUserState } from '@/modules/jobs'
import { getMatchCard } from '@/modules/matching'
import { getCandidateProfile } from '@/modules/profiles'
import { listResumes } from '@/modules/resumes'
import { ApplicationReadiness } from '../../answers/_components/ApplicationReadiness'
import { LogApplicationForm } from '../../applications/_components/ApplicationForms'
import { STATUS_LABELS } from '../../applications/_components/ApplicationStatus'
import { CompanyMark } from '../_components/CompanyMark'
import { EligibilityDetails } from '../_components/EligibilityDetails'
import { BackIcon, CashIcon, ExternalIcon, PinIcon } from '../_components/icons'
import { JobActions } from '../_components/JobActions'
import { MatchDetails } from '../_components/MatchDetails'
import { listFrom } from '../_lib/back'
import { formatLocation, formatPosted, formatSalary } from '../_lib/format'
import styles from '../jobs.module.css'
import { FillApplication } from './apply/_components/FillApplication'

export const dynamic = 'force-dynamic'

export default async function JobPage({ params, searchParams }: {
  readonly params: { readonly jobId: string }
  readonly searchParams: Record<string, string | string[] | undefined>
}) {
  const parsed = z.uuid().safeParse(params.jobId)
  if (!parsed.success) notFound()
  const jobId = parsed.data
  const error = z.string().catch('').parse(searchParams.error)
  const notice = z.string().catch('').parse(searchParams.notice)
  const from = listFrom(searchParams.from)
  // Actions on this page come back here, still knowing which list to return to.
  const self = from.href === '/jobs' ? `/jobs/${jobId}` : `/jobs/${jobId}?${new URLSearchParams({ from: from.href })}`
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
  const readiness = tab === 'can_apply' ? (await readinessForJobs(db, DEV_USER.id, [job])).get(jobId) ?? { kind: 'not_fetched' } : null
  const applicationContext = await withTenant(db, DEV_USER.id, async (scope) => ({
    application: await getApplicationForJob(scope, jobId),
    fill: await expireFills(scope).then(() => latestFillForJob(scope, jobId)),
    resumes: await listResumes(scope), profile: await getCandidateProfile(scope),
  }))
  const application = applicationContext.application
  const posted = formatPosted(job.postedAt, new Date())

  return (
    <main className={styles.page}>
      <Link href={from.href} className={styles.backLink}><BackIcon />Back to {from.label}</Link>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      <header className={styles.jobHeader}>
        <CompanyMark name={job.companyName} large />
        <div>
          <div className={styles.cardTop}>
            <span className={styles.company}>{job.companyName}</span>
            {posted !== null && <span>· {posted}</span>}
          </div>
          <h1>{job.title}</h1>
          <ul className={styles.meta}>
            <li><PinIcon />{formatLocation(job.locationText)}</li>
            <li><CashIcon />{formatSalary(job.salary) ?? 'Salary not stated'}</li>
          </ul>
          {job.salaryQuote !== null && <p className={styles.salaryQuote}>From the posting: “{job.salaryQuote}”</p>}
          <div className={styles.badges}>
            {userState?.state === 'saved' && <span className={styles.pill}>Saved</span>}
            {userState?.state === 'applied' && <span className={styles.pill}>Applied</span>}
            {assessment.userOverride !== null && <span className={styles.pill}>Your verdict</span>}
          </div>
          <div className={styles.headerActions}>
            <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" className={`${styles.button} ${styles.primary}`}>View original posting<ExternalIcon /></a>
            <JobActions assessment={assessment} userState={userState} tab={tab} back={self} offerReason />
          </div>
        </div>
      </header>
      <EligibilityDetails assessment={assessment} />
      <MatchDetails card={card} />
      {readiness !== null && <ApplicationReadiness readiness={readiness} jobId={jobId} back={`/jobs/${jobId}`} />}
      {tab === 'can_apply' && application === null && <FillApplication jobId={jobId} fill={applicationContext.fill} />}
      <section className={styles.section} aria-labelledby="application-heading">
        <h2 id="application-heading">Your application</h2>
        {application !== null ? <>
          <p>Applied on {application.appliedOn} · {STATUS_LABELS[application.status]}</p>
          <Link href={`/applications/${application.id}`}>Open application</Link>
        </> : <LogApplicationForm jobId={jobId} applyUrl={job.applyUrl} resumes={applicationContext.resumes} defaultCurrency={applicationContext.profile?.salaryCurrency ?? 'USD'} />}
      </section>
      <section className={styles.section} aria-labelledby="description-heading">
        <h2 id="description-heading">Full description</h2>
        <div className={styles.description}>{job.description}</div>
      </section>
    </main>
  )
}
