import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { getApplication, postingAsApplied } from '@/modules/applications'
import { getJob } from '@/modules/jobs'
import { getCandidateProfile } from '@/modules/profiles'
import { getResume, listResumes } from '@/modules/resumes'
import { AppNavigation } from '../../_components/AppNavigation'
import { ApplicationDetails, ApplicationHistory, AppliedPosting } from '../_components/ApplicationDetails'
import { ChangeStageForm, EditApplicationForm } from '../_components/ApplicationForms'
import { ApplicationStatusBadge } from '../_components/ApplicationStatus'
import styles from '../applications.module.css'

export const dynamic = 'force-dynamic'

export default async function ApplicationPage({ params, searchParams }: {
  readonly params: { readonly applicationId: string }
  readonly searchParams: Record<string, string | string[] | undefined>
}) {
  const parsed = z.uuid().safeParse(params.applicationId)
  if (!parsed.success) notFound()
  const error = z.string().catch('').parse(searchParams.error)
  const db = getDb()
  const result = await withTenant(db, DEV_USER.id, (scope) => getApplication(scope, parsed.data))
  if (!result.ok) notFound()
  const { application, events } = result.value
  const [jobResult, posting, context] = await Promise.all([
    getJob(db, application.jobId),
    postingAsApplied(db, application),
    withTenant(db, DEV_USER.id, async (scope) => {
      const resume = application.resumeId === null ? null : await getResume(scope, application.resumeId)
      return {
        resume: resume?.ok ? resume.value : null,
        resumes: await listResumes(scope), profile: await getCandidateProfile(scope),
      }
    }),
  ])
  if (!jobResult.ok) notFound()
  const job = jobResult.value
  return (
    <main className={styles.page}>
      <AppNavigation currentPath={`/applications/${application.id}`} />
      <nav aria-label="Application navigation" className={styles.navigation}><Link href="/applications">← Applications</Link><Link href={`/jobs/${job.id}`}>Open job</Link></nav>
      <header>
        <p className={styles.eyebrow}>{job.companyName}</p><h1>{job.title}</h1>
        <ApplicationStatusBadge status={application.status} />
        <p>Applied on {application.appliedOn}</p>
      </header>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <ApplicationDetails application={application} resume={context.resume} />
      <section className={styles.section} aria-labelledby="stage-heading">
        <h2 id="stage-heading">Change stage</h2>
        <ChangeStageForm application={application} />
      </section>
      <ApplicationHistory events={events} />
      <section className={styles.section} aria-labelledby="edit-heading">
        <h2 id="edit-heading">Edit details</h2>
        <EditApplicationForm application={application} resumes={context.resumes} defaultCurrency={context.profile?.salaryCurrency ?? 'USD'} />
      </section>
      <AppliedPosting posting={posting} closed={job.closedAt !== null} />
    </main>
  )
}
