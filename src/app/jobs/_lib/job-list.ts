import { openToRegion, REVIEW_GROUPS, reviewGroup, type Assessment, type Region, type ReviewGroup, type WorkplaceClaims } from '@/modules/eligibility'
import type { Job, JobUserState } from '@/modules/jobs'
import { compareForReview, type Match } from '@/modules/matching'

export type JobTab = ReviewGroup | 'hidden'

export const TAB_LABELS: Record<JobTab, string> = {
  can_apply: 'Can apply', needs_review: 'Needs review', location_only: 'Probably onsite',
  visa_unknown: 'Needs a visa', not_eligible: 'Not eligible', hidden: 'Hidden',
}

export const TAB_DESCRIPTIONS: Record<JobTab, string> = {
  can_apply: 'Jobs whose posting shows you can take them, or that you marked yourself.',
  needs_review: 'The posting leaves something open. Each job says what.',
  location_only: 'The posting names a place but never says remote, hybrid or onsite. Not matched unless you mark it.',
  visa_unknown: 'You would need work authorization there, and the posting does not say whether it sponsors visas. Not matched unless you mark it.',
  not_eligible: 'The posting rules you out. Each job quotes the sentence that does.',
  hidden: 'Jobs you hid. They appear nowhere else.',
}

export const WORK_FILTERS = ['remote', 'hybrid', 'onsite', 'not_stated'] as const
export type WorkFilter = (typeof WORK_FILTERS)[number]
export const WORK_LABELS: Record<WorkFilter, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'Onsite', not_stated: 'Not stated' }

/** Each region option includes worldwide postings; "worldwide" alone means only those. */
export const REGION_FILTERS = ['latam', 'namer', 'emea', 'apac', 'worldwide'] as const satisfies readonly Region[]
export const REGION_LABELS: Record<(typeof REGION_FILTERS)[number], string> = {
  latam: 'Open to Latin America', namer: 'Open to North America', emea: 'Open to Europe, Middle East & Africa',
  apac: 'Open to Asia-Pacific', worldwide: 'Worldwide only',
}

export type Row = {
  readonly job: Job
  readonly assessment: Assessment
  readonly match: Match | null
  readonly userState: JobUserState | null
}

export type JobListInput = {
  readonly assessments: readonly Assessment[]
  readonly jobs: readonly Job[]
  readonly matches: readonly Match[]
  readonly userStates: readonly JobUserState[]
  readonly tab: JobTab
  readonly page: number
  readonly company: string
  /** '' for any. */
  readonly work: WorkFilter | ''
  readonly region: Region | ''
  readonly location: string
  /** Where each posting says the work happens, by job; a job missing here matches only the "any" filters. */
  readonly workplace: ReadonlyMap<string, WorkplaceClaims>
}

export type JobList = {
  readonly tabs: { key: JobTab; label: string; count: number }[]
  readonly rows: Row[]
  /** Rows in the current tab that pass the filters, across all pages. */
  readonly matching: number
  readonly page: number
  readonly pageCount: number
}

function compareRows(a: Row, b: Row): number {
  const matchOrder = compareForReview(a.match, b.match)
  if (matchOrder !== 0) return matchOrder
  const aDate = a.job.postedAt?.getTime() ?? -Infinity
  const bDate = b.job.postedAt?.getTime() ?? -Infinity
  if (aDate !== bDate) return aDate > bDate ? -1 : 1
  return a.job.id.localeCompare(b.job.id)
}

/** A job is remote, hybrid or onsite if its own field or its text says so; not stated if neither does. */
function worksAs(job: Job, workplace: WorkplaceClaims | undefined, work: WorkFilter): boolean {
  const claimed = workplace?.onsite.kind ?? 'unspecified'
  if (work === 'not_stated') return job.locationPolicy === 'unknown' && claimed === 'unspecified'
  return job.locationPolicy === work || claimed === work
}

function passesFilters(job: Job, input: JobListInput): boolean {
  const company = input.company.trim().toLowerCase()
  const location = input.location.trim().toLowerCase()
  const workplace = input.workplace.get(job.id)
  if (!job.companyName.toLowerCase().includes(company)) return false
  if (location !== '' && !(job.locationText ?? '').toLowerCase().includes(location)) return false
  if (input.work !== '' && !worksAs(job, workplace, input.work)) return false
  if (input.region !== '' && !(workplace && openToRegion(workplace.remoteScope, input.region))) return false
  return true
}

export function buildJobList(input: JobListInput): JobList {
  const assessments = new Map(input.assessments.map((assessment) => [assessment.jobId, assessment]))
  const matches = new Map(input.matches.map((match) => [match.jobId, match]))
  const states = new Map(input.userStates.map((state) => [state.jobId, state]))
  const keys: readonly JobTab[] = [...REVIEW_GROUPS, 'hidden']
  const tabs = keys.map((key) => ({ key, label: TAB_LABELS[key], count: 0 }))
  const rows: Row[] = []
  for (const job of input.jobs) {
    const assessment = assessments.get(job.id)
    if (!assessment || job.closedAt !== null || job.canonicalJobId !== null) continue
    const userState = states.get(job.id) ?? null
    const group = userState?.state === 'ignored' ? 'hidden' : reviewGroup(assessment)
    const tab = tabs.find((tab) => tab.key === group)
    if (tab) tab.count += 1
    if (group === input.tab && passesFilters(job, input)) {
      rows.push({ job, assessment, userState, match: matches.get(job.id) ?? null })
    }
  }
  rows.sort(compareRows)
  const pageCount = Math.max(1, Math.ceil(rows.length / 50))
  const page = Math.min(Math.max(1, Math.floor(input.page)), pageCount)
  return { tabs, rows: rows.slice((page - 1) * 50, page * 50), matching: rows.length, page, pageCount }
}
