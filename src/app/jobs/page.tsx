import Link from 'next/link'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { readinessForJobs, type JobReadiness } from '@/modules/application-answers'
import { listAssessments, REVIEW_GROUPS } from '@/modules/eligibility'
import { getJobs, listJobUserStates } from '@/modules/jobs'
import { listMatches, REVIEW_ORDER } from '@/modules/matching'
import { AppNavigation } from '../_components/AppNavigation'
import { JobRow } from './_components/JobRow'
import { buildJobList, TAB_DESCRIPTIONS, type JobTab } from './_lib/job-list'
import styles from './jobs.module.css'

export const dynamic = 'force-dynamic'

const SearchSchema = z.object({
  tab: z.enum([...REVIEW_GROUPS, 'hidden']).catch('can_apply'),
  page: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(Number.MAX_SAFE_INTEGER)).catch(1),
  company: z.string().catch(''),
  error: z.string().catch(''),
})

function jobsUrl(tab: JobTab, company: string, page = 1): string {
  return `/jobs?${new URLSearchParams({ tab, company, page: String(page) })}`
}

export default async function JobsPage({ searchParams }: {
  readonly searchParams: Record<string, string | string[] | undefined>
}) {
  const query = SearchSchema.parse(searchParams)
  const db = getDb()
  const assessments = await withTenant(db, DEV_USER.id, listAssessments)
  const userStates = await withTenant(db, DEV_USER.id, listJobUserStates)
  const matches = await withTenant(db, DEV_USER.id, listMatches)
  const jobs = await getJobs(db, assessments.map((assessment) => assessment.jobId))
  const list = buildJobList({ assessments, userStates, matches, jobs, ...query })
  const readiness = query.tab === 'can_apply'
    ? await readinessForJobs(db, DEV_USER.id, list.rows.map((row) => row.job)) : new Map<string, JobReadiness>()
  const back = jobsUrl(query.tab, query.company, list.page)

  return (
    <main className={styles.page}>
      <AppNavigation currentPath="/jobs" />
      <header><p className={styles.eyebrow}>Job Seeker Assistant · Your search</p><h1>Jobs</h1></header>
      {query.error && <p role="alert" className={styles.error}>{query.error}</p>}
      <nav aria-label="Jobs by eligibility" className={styles.tabs}>
        {list.tabs.map((tab) => <Link key={tab.key} href={jobsUrl(tab.key, query.company)} aria-current={tab.key === query.tab ? 'page' : undefined}>{tab.label} ({tab.count})</Link>)}
      </nav>
      <p>{TAB_DESCRIPTIONS[query.tab]}</p>
      <form method="get" action="/jobs" className={styles.filter}>
        <input type="hidden" name="tab" value={query.tab} />
        <label htmlFor="company">Company<input id="company" name="company" type="text" defaultValue={query.company} /></label>
        <button type="submit">Filter</button>
      </form>
      <p className={styles.muted}>{REVIEW_ORDER}</p>
      <section aria-label="Jobs">
        {list.rows.length === 0 ? <p className={styles.section}>No jobs in this tab match your filter.</p>
          : list.rows.map((row) => {
            const application = readiness.get(row.job.id)
            return <JobRow key={row.job.id} row={row} tab={query.tab} back={back}
              readyToSend={application?.kind === 'assessed' && application.readiness.status === 'ready'} />
          })}
      </section>
      <nav aria-label="Pagination" className={styles.pagination}>
        {list.page > 1 && <Link href={jobsUrl(query.tab, query.company, list.page - 1)}>Previous</Link>}
        <span>Page {list.page} of {list.pageCount}</span>
        {list.page < list.pageCount && <Link href={jobsUrl(query.tab, query.company, list.page + 1)}>Next</Link>}
      </nav>
    </main>
  )
}
