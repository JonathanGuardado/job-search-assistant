import { openToRegion, REVIEW_GROUPS, reviewGroup, type Assessment, type Region, type ReviewGroup, type WorkplaceClaims } from '@/modules/eligibility'
import type { JobSummary, JobUserState } from '@/modules/jobs'
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

/** How recently a job was posted, in days. */
export const POSTED_FILTERS = ['1', '3', '7', '14', '30'] as const
export type PostedFilter = (typeof POSTED_FILTERS)[number]
export const POSTED_LABELS: Record<PostedFilter, string> = {
  1: 'Last 24 hours', 3: 'Last 3 days', 7: 'Last week', 14: 'Last 2 weeks', 30: 'Last month',
}
const DAY_MS = 86_400_000

/**
 * How a job is applied to. assistant: its site publishes a form the assistant can fill.
 * ready: nothing on that form still waits for the owner.
 */
export const APPLY_FILTERS = ['assistant', 'ready'] as const
export type ApplyFilter = (typeof APPLY_FILTERS)[number]
export const APPLY_LABELS: Record<ApplyFilter, string> = { assistant: 'The assistant fills the form', ready: 'Ready to send' }

export type Row = {
  readonly job: JobSummary
  readonly assessment: Assessment
  readonly match: Match | null
  readonly userState: JobUserState | null
}

export type JobListInput = {
  readonly assessments: readonly Assessment[]
  readonly jobs: readonly JobSummary[]
  readonly matches: readonly Match[]
  readonly userStates: readonly JobUserState[]
  readonly tab: JobTab
  readonly page: number
  readonly company: string
  /** '' for any. */
  readonly work: WorkFilter | ''
  readonly region: Region | ''
  readonly location: string
  /** '' for any time; a job without a posting date matches only that. */
  readonly posted: PostedFilter | ''
  /** '' for any way of applying. */
  readonly apply: ApplyFilter | ''
  /** The sources whose application forms the assistant can fill. */
  readonly fillableSources: ReadonlySet<string>
  /** The jobs whose form has nothing left for the owner to answer; read only by the "ready" filter. */
  readonly readyJobs: ReadonlySet<string>
  /** What "posted in the last N days" counts back from. */
  readonly now: Date
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
function worksAs(job: JobSummary, workplace: WorkplaceClaims | undefined, work: WorkFilter): boolean {
  const claimed = workplace?.onsite.kind ?? 'unspecified'
  if (work === 'not_stated') return job.locationPolicy === 'unknown' && claimed === 'unspecified'
  return job.locationPolicy === work || claimed === work
}

/** Open to the region by the posting's own scope; where the text states none, by the countries its job board lists (decision 0017). */
function openTo(job: JobSummary, workplace: WorkplaceClaims | undefined, region: Region): boolean {
  if (workplace === undefined) return false
  if (workplace.remoteScope.kind !== 'unspecified') return openToRegion(workplace.remoteScope, region)
  return openToRegion({ kind: 'countries', countries: [...job.remoteCountries ?? []] }, region)
}

function passesFilters(job: JobSummary, input: JobListInput): boolean {
  const company = input.company.trim().toLowerCase()
  const location = input.location.trim().toLowerCase()
  const workplace = input.workplace.get(job.id)
  if (!job.companyName.toLowerCase().includes(company)) return false
  if (location !== '' && !(job.locationText ?? '').toLowerCase().includes(location)) return false
  if (input.work !== '' && !worksAs(job, workplace, input.work)) return false
  if (input.region !== '' && !openTo(job, workplace, input.region)) return false
  if (input.posted !== '' && !(job.postedAt && input.now.getTime() - job.postedAt.getTime() <= Number(input.posted) * DAY_MS)) return false
  if (input.apply === 'assistant' && !input.fillableSources.has(job.sourceId)) return false
  if (input.apply === 'ready' && !input.readyJobs.has(job.id)) return false
  return true
}

type Grouped = Pick<JobListInput, 'assessments' | 'jobs' | 'userStates'>

/** Every job a tab can show, with the tab it belongs to: open, not a linked duplicate, and assessed. */
function* visibleJobs(input: Grouped): Generator<{ job: JobSummary; assessment: Assessment; userState: JobUserState | null; group: JobTab }> {
  const assessments = new Map(input.assessments.map((assessment) => [assessment.jobId, assessment]))
  const states = new Map(input.userStates.map((state) => [state.jobId, state]))
  for (const job of input.jobs) {
    const assessment = assessments.get(job.id)
    if (!assessment || job.closedAt !== null || job.canonicalJobId !== null) continue
    const userState = states.get(job.id) ?? null
    yield { job, assessment, userState, group: userState?.state === 'ignored' ? 'hidden' : reviewGroup(assessment) }
  }
}

/** The "Can apply" jobs whose form the assistant can fill: the ones whose readiness the "ready" filter needs. */
export function fillableJobs(input: Grouped & Pick<JobListInput, 'fillableSources'>): JobSummary[] {
  return [...visibleJobs(input)].filter(({ job, group }) => group === 'can_apply' && input.fillableSources.has(job.sourceId)).map(({ job }) => job)
}

export function buildJobList(input: JobListInput): JobList {
  const matches = new Map(input.matches.map((match) => [match.jobId, match]))
  const keys: readonly JobTab[] = [...REVIEW_GROUPS, 'hidden']
  const tabs = keys.map((key) => ({ key, label: TAB_LABELS[key], count: 0 }))
  const rows: Row[] = []
  for (const { job, assessment, userState, group } of visibleJobs(input)) {
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
