import Link from 'next/link'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { APPLICATION_STATUSES, listApplications } from '@/modules/applications'
import { getJobs } from '@/modules/jobs'
import { ApplicationStatusBadge, STATUS_LABELS } from './_components/ApplicationStatus'
import styles from './applications.module.css'

export const dynamic = 'force-dynamic'

const SearchSchema = z.object({
  status: z.enum(['all', ...APPLICATION_STATUSES]).catch('all'),
  error: z.string().catch(''),
})

export default async function ApplicationsPage({ searchParams }: {
  readonly searchParams: Record<string, string | string[] | undefined>
}) {
  const query = SearchSchema.parse(searchParams)
  const db = getDb()
  const applications = await withTenant(db, DEV_USER.id, listApplications)
  const jobs = new Map((await getJobs(db, applications.map((application) => application.jobId))).map((job) => [job.id, job]))
  const filtered = applications.filter((application) => query.status === 'all' || application.status === query.status)
  return (
    <main className={styles.page}>
      <nav className={styles.navigation}><Link href="/jobs">Jobs</Link><Link href="/resumes">Resume library</Link><Link href="/settings">Candidate settings</Link><Link href="/sources">Job sources</Link><Link href="/answers">Answers</Link></nav>
      <header><p className={styles.eyebrow}>Job Seeker Assistant · Your search</p><h1>Applications</h1></header>
      {query.error && <p role="alert" className={styles.error}>{query.error}</p>}
      <nav aria-label="Applications by stage" className={styles.tabs}>
        <Link href="/applications?status=all" aria-current={query.status === 'all' ? 'page' : undefined}>All ({applications.length})</Link>
        {APPLICATION_STATUSES.map((status) => <Link key={status} href={`/applications?status=${status}`} aria-current={status === query.status ? 'page' : undefined}>{STATUS_LABELS[status]} ({applications.filter((application) => application.status === status).length})</Link>)}
      </nav>
      <section aria-label="Applications">
        {applications.length === 0 ? <p className={styles.section}>No applications yet. Mark a job applied from its page.</p>
          : filtered.length === 0 ? <p className={styles.section}>No applications in this stage.</p>
            : filtered.map((application) => {
              const job = jobs.get(application.jobId)
              return <article key={application.id} className={styles.section}>
                <p className={styles.company}>{job?.companyName ?? 'Company unavailable'}</p>
                <h2><Link href={`/applications/${application.id}`}>{job?.title ?? 'Job unavailable'}</Link></h2>
                <ApplicationStatusBadge status={application.status} />
                <p>Applied {application.appliedOn}</p>
                <p className={styles.muted}>Last activity {application.lastActivityOn}</p>
                {job && job.closedAt !== null && <p>Posting taken down</p>}
              </article>
            })}
      </section>
    </main>
  )
}
