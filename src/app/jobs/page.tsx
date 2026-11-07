import Link from 'next/link'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { readinessForJobs, type JobReadiness } from '@/modules/application-answers'
import { listAssessments, REVIEW_GROUPS, workplaceClaimsFor } from '@/modules/eligibility'
import { getJobs, listJobUserStates } from '@/modules/jobs'
import { listMatches, REVIEW_ORDER } from '@/modules/matching'
import { AppNavigation } from '../_components/AppNavigation'
import { JobRow } from './_components/JobRow'
import {
  buildJobList, REGION_FILTERS, REGION_LABELS, TAB_DESCRIPTIONS, WORK_FILTERS, WORK_LABELS, type JobTab,
} from './_lib/job-list'
import styles from './jobs.module.css'

export const dynamic = 'force-dynamic'

const SearchSchema = z.object({
  tab: z.enum([...REVIEW_GROUPS, 'hidden']).catch('can_apply'),
  page: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(Number.MAX_SAFE_INTEGER)).catch(1),
  company: z.string().catch(''),
  work: z.enum([...WORK_FILTERS, '']).catch(''),
  region: z.enum([...REGION_FILTERS, '']).catch(''),
  location: z.string().catch(''),
  error: z.string().catch(''),
})

type Filters = Pick<z.infer<typeof SearchSchema>, 'company' | 'work' | 'region' | 'location'>

/** The list's address; filters that are not set stay out of it. */
function jobsUrl(tab: JobTab, filters: Filters, page = 1): string {
  const set = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  return `/jobs?${new URLSearchParams([['tab', tab], ...set, ['page', String(page)]])}`
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
  const workplace = await workplaceClaimsFor(db, assessments.flatMap((assessment) => assessment.claimsId ?? []))
  const list = buildJobList({ assessments, userStates, matches, jobs, workplace, ...query })
  const filters: Filters = { company: query.company, work: query.work, region: query.region, location: query.location }
  const filtered = Object.values(filters).some((value) => value.trim() !== '')
  const readiness = query.tab === 'can_apply'
    ? await readinessForJobs(db, DEV_USER.id, list.rows.map((row) => row.job)) : new Map<string, JobReadiness>()
  const back = jobsUrl(query.tab, filters, list.page)

  return (
    <main className={styles.page}>
      <AppNavigation currentPath="/jobs" />
      <header><p className={styles.eyebrow}>Job Seeker Assistant · Your search</p><h1>Jobs</h1></header>
      {query.error && <p role="alert" className={styles.error}>{query.error}</p>}
      <nav aria-label="Jobs by eligibility" className={styles.tabs}>
        {list.tabs.map((tab) => <Link key={tab.key} href={jobsUrl(tab.key, filters)} aria-current={tab.key === query.tab ? 'page' : undefined}>{tab.label} ({tab.count})</Link>)}
      </nav>
      <p>{TAB_DESCRIPTIONS[query.tab]}</p>
      <form method="get" action="/jobs" className={styles.filter}>
        <input type="hidden" name="tab" value={query.tab} />
        <label htmlFor="company">Company<input id="company" name="company" type="text" defaultValue={query.company} /></label>
        <label htmlFor="work">Work
          <select id="work" name="work" defaultValue={query.work}>
            <option value="">Any</option>
            {WORK_FILTERS.map((work) => <option key={work} value={work}>{WORK_LABELS[work]}</option>)}
          </select>
        </label>
        <label htmlFor="region">Region
          <select id="region" name="region" defaultValue={query.region}>
            <option value="">Any region</option>
            {REGION_FILTERS.map((region) => <option key={region} value={region}>{REGION_LABELS[region]}</option>)}
          </select>
        </label>
        <label htmlFor="location">Location contains<input id="location" name="location" type="text" defaultValue={query.location} placeholder="e.g. LATAM, Mexico, Remote" /></label>
        <button type="submit">Filter</button>
        {filtered && <Link href={jobsUrl(query.tab, { company: '', work: '', region: '', location: '' })}>Clear</Link>}
      </form>
      {filtered && <p className={styles.muted}>{list.matching} {list.matching === 1 ? 'job matches' : 'jobs match'} your filters in this tab. Regions include worldwide postings.</p>}
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
        {list.page > 1 && <Link href={jobsUrl(query.tab, filters, list.page - 1)}>Previous</Link>}
        <span>Page {list.page} of {list.pageCount}</span>
        {list.page < list.pageCount && <Link href={jobsUrl(query.tab, filters, list.page + 1)}>Next</Link>}
      </nav>
    </main>
  )
}
