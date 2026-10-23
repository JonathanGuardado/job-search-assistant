import { REVIEW_GROUPS, reviewGroup, type Assessment, type ReviewGroup } from '@/modules/eligibility'
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
}

export type JobList = {
  readonly tabs: { key: JobTab; label: string; count: number }[]
  readonly rows: Row[]
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

export function buildJobList(input: JobListInput): JobList {
  const assessments = new Map(input.assessments.map((assessment) => [assessment.jobId, assessment]))
  const matches = new Map(input.matches.map((match) => [match.jobId, match]))
  const states = new Map(input.userStates.map((state) => [state.jobId, state]))
  const keys: readonly JobTab[] = [...REVIEW_GROUPS, 'hidden']
  const tabs = keys.map((key) => ({ key, label: TAB_LABELS[key], count: 0 }))
  const rows: Row[] = []
  const company = input.company.trim().toLowerCase()
  for (const job of input.jobs) {
    const assessment = assessments.get(job.id)
    if (!assessment || job.closedAt !== null || job.canonicalJobId !== null) continue
    const userState = states.get(job.id) ?? null
    const group = userState?.state === 'ignored' ? 'hidden' : reviewGroup(assessment)
    const tab = tabs.find((tab) => tab.key === group)
    if (tab) tab.count += 1
    if (group === input.tab && job.companyName.toLowerCase().includes(company)) {
      rows.push({ job, assessment, userState, match: matches.get(job.id) ?? null })
    }
  }
  rows.sort(compareRows)
  const pageCount = Math.max(1, Math.ceil(rows.length / 50))
  const page = Math.min(Math.max(1, Math.floor(input.page)), pageCount)
  return { tabs, rows: rows.slice((page - 1) * 50, page * 50), page, pageCount }
}
