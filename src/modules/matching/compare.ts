import type { Job, Seniority } from '@/modules/jobs'
import type { CandidateProfileInput } from '@/modules/profiles'
import { experienceMonths, yearsLabel } from './experience.js'
import { impliedSkills, skillKey, skillsMentioned } from './skills.js'
import type {
  CandidateEvidence,
  Dimension,
  DimensionStatus,
  Dimensions,
  Finding,
  Importance,
  JobRequirements,
  LanguageRequirement,
  MatchResult,
  SalaryCompatibility,
  SkillRequirement,
} from './types.js'

/*
 * Requirements × candidate → dimensions. Every status here is decided by code from the
 * extracted requirements, the structured job fields, and the candidate's own record
 * (CLAUDE.md rule 3). There is no overall score: each dimension stands on its evidence.
 */

export type MatchJob = Pick<Job, 'title' | 'companyName' | 'seniority' | 'employmentType' | 'salary'>

export type MatchCareerItem = {
  readonly id: string
  readonly type: 'role' | 'project' | 'education' | 'achievement' | 'story'
  readonly title: string | null
  readonly organization: string | null
  readonly startedOn: string | null
  readonly endedOn: string | null
  readonly isCurrent: boolean
  readonly summary: string | null
  readonly achievements: readonly string[]
  readonly technologies: readonly string[]
  readonly verifiedByUser: boolean
}

export type MatchCandidate = {
  readonly profile: Pick<CandidateProfileInput,
    'targetRoles' | 'seniority' | 'preferredTech' | 'excludedTech' | 'excludedCompanies' | 'employmentTypes'
    | 'salaryFloorMinor' | 'salaryCurrency' | 'spokenLanguages'>
  readonly careerItems: readonly MatchCareerItem[]
}

// ---------------------------------------------------------------------------
// Where the candidate's record shows each skill.

const VIA_RANK: Record<CandidateEvidence['via'], number> = { technologies: 0, text: 1, implied: 2 }

function labelOf(item: MatchCareerItem): string {
  if (item.title && item.organization) return `${item.title} at ${item.organization}`
  return item.title ?? item.organization ?? item.type
}

/** Per career item, the best evidence for each skill key it shows. */
function evidenceBySkill(items: readonly MatchCareerItem[]): Map<string, Array<{ item: MatchCareerItem; evidence: CandidateEvidence }>> {
  const bySkill = new Map<string, Array<{ item: MatchCareerItem; evidence: CandidateEvidence }>>()
  for (const item of items) {
    const best = new Map<string, CandidateEvidence>()
    const offer = (key: string, via: CandidateEvidence['via'], text: string) => {
      const current = best.get(key)
      if (current && VIA_RANK[current.via] <= VIA_RANK[via]) return
      best.set(key, { careerItemId: item.id, label: labelOf(item), via, text, isVerified: item.verifiedByUser })
    }
    for (const technology of item.technologies) {
      const key = skillKey(technology)
      offer(key, 'technologies', technology)
      for (const implied of impliedSkills(key)) offer(implied, 'implied', technology)
    }
    for (const sentence of [item.title, item.summary, ...item.achievements]) {
      if (sentence) for (const key of skillsMentioned(sentence)) offer(key, 'text', sentence)
    }
    for (const [key, evidence] of best) bySkill.set(key, [...(bySkill.get(key) ?? []), { item, evidence }])
  }
  return bySkill
}

/** Confirmed items first, then the most recent. */
function byStrength(a: { item: MatchCareerItem }, b: { item: MatchCareerItem }): number {
  if (a.item.verifiedByUser !== b.item.verifiedByUser) return a.item.verifiedByUser ? -1 : 1
  const recency = (item: MatchCareerItem) => (item.isCurrent ? '9999' : item.endedOn ?? item.startedOn ?? '')
  return recency(b.item).localeCompare(recency(a.item))
}

const yearsNote = (minYears: number, months: number) => `asks ${minYears}+ years; your record shows at least ${yearsLabel(months)}`

function skillFinding(requirement: SkillRequirement, bySkill: ReturnType<typeof evidenceBySkill>, today: Date): Finding {
  const shown = [...(bySkill.get(skillKey(requirement.name)) ?? [])].sort(byStrength)
  const base = { requirement: requirement.name, importance: requirement.importance, quote: requirement.quote, evidence: shown.map((s) => s.evidence) }
  if (shown.length === 0) return { ...base, status: 'missing', note: null }
  if (requirement.minYears === null) return { ...base, status: 'met', note: null }
  const months = experienceMonths(shown.filter((s) => s.item.type === 'role').map((s) => s.item), today)
  if (months === null) return { ...base, status: 'unknown', note: `asks ${requirement.minYears}+ years; your record does not date it` }
  return { ...base, status: months >= requirement.minYears * 12 ? 'met' : 'short', note: yearsNote(requirement.minYears, months) }
}

function skillsDimension(findings: Finding[]): Dimension {
  if (findings.length === 0) return { status: 'not_stated', findings }
  const met = findings.filter((f) => f.status === 'met').length
  if (met === findings.length) return { status: 'meets', findings }
  if (findings.every((f) => f.status === 'missing')) return { status: 'gap', findings }
  return { status: 'partial', findings }
}

// ---------------------------------------------------------------------------
// Dimensions read from the posting's text.

function experienceDimension(requirements: JobRequirements, items: readonly MatchCareerItem[], today: Date): Dimension {
  const asked = requirements.experience
  if (asked === null) return { status: 'not_stated', findings: [] }
  const months = experienceMonths(items.filter((item) => item.type === 'role'), today)
  const base = { requirement: `${asked.minYears}+ years of experience`, importance: 'required' as const, quote: asked.quote, evidence: [] }
  if (months === null) return { status: 'unknown', findings: [{ ...base, status: 'unknown', note: 'your roles have no dates to count' }] }
  const isEnough = months >= asked.minYears * 12
  return { status: isEnough ? 'meets' : 'gap', findings: [{ ...base, status: isEnough ? 'met' : 'short', note: yearsNote(asked.minYears, months) }] }
}

const languageNames = new Intl.DisplayNames('en', { type: 'language' })
export const languageName = (code: string): string => languageNames.of(code) ?? code

function languagesDimension(asked: readonly LanguageRequirement[], spoken: readonly string[]): Dimension {
  if (asked.length === 0) return { status: 'not_stated', findings: [] }
  const finding = (language: LanguageRequirement): Finding => {
    const base = { requirement: languageName(language.language), importance: language.importance, quote: language.quote, evidence: [] }
    if (spoken.length === 0) return { ...base, status: 'unknown', note: 'add the languages you work in to your settings' }
    return { ...base, status: spoken.includes(language.language) ? 'met' : 'missing', note: null }
  }
  const findings = asked.map(finding)
  if (findings.some((f) => f.status === 'unknown')) return { status: 'unknown', findings }
  if (findings.some((f) => f.status === 'missing' && f.importance === 'required')) return { status: 'gap', findings }
  return { status: findings.every((f) => f.status === 'met') ? 'meets' : 'partial', findings }
}

// ---------------------------------------------------------------------------
// Dimensions read from structured fields and the profile.

const ROLE_FILLER = new Set(['senior', 'sr', 'junior', 'jr', 'staff', 'principal', 'lead', 'mid', 'level', 'i', 'ii', 'iii', 'iv', 'of', 'and', 'the', 'a', 'an', 'for', 'to', 'in', 'remote', 'hybrid'])
const ROLE_SYNONYMS: Readonly<Record<string, string>> = { developer: 'engineer', dev: 'engineer', programmer: 'engineer', swe: 'engineer', sde: 'engineer' }

function roleWords(title: string): string[] {
  return title.toLowerCase()
    .replace(/full[\s-]?stack/g, 'fullstack').replace(/front[\s-]?end/g, 'frontend').replace(/back[\s-]?end/g, 'backend')
    .split(/[^a-z0-9+#]+/)
    .map((word) => ROLE_SYNONYMS[word] ?? word)
    .filter((word) => word && !ROLE_FILLER.has(word))
}

function roleDimension(title: string, targets: readonly string[]): Dimension {
  const titleWords = new Set(roleWords(title))
  const finding = (status: Finding['status'], requirement: string, note: string): Dimension => ({
    status: status === 'met' ? 'meets' : status === 'short' ? 'partial' : 'gap',
    findings: [{ requirement, importance: 'preferred', quote: null, status, note, evidence: [] }],
  })
  const exact = targets.find((target) => { const words = roleWords(target); return words.length > 0 && words.every((w) => titleWords.has(w)) })
  if (exact) return finding('met', exact, `“${title}” matches your target “${exact}”`)
  // The last word of a role names its kind (engineer, designer, manager); sharing it is close.
  const close = targets.find((target) => { const kind = roleWords(target).at(-1); return kind !== undefined && titleWords.has(kind) })
  if (close) return finding('short', close, `“${title}” is close to your target “${close}”`)
  return finding('missing', targets.join(', '), `“${title}” is not one of your target roles`)
}

/** Lead and staff are the same rung reached by different tracks. */
const SENIORITY_RANK: Record<Seniority, number> = { intern: 0, junior: 1, senior: 2, lead: 3, staff: 3, principal: 4 }
const SENIORITY_WORDS: Readonly<Record<string, Seniority>> = {
  intern: 'intern', junior: 'junior', jr: 'junior', senior: 'senior', sr: 'senior', lead: 'lead', staff: 'staff', principal: 'principal',
}

function senioritiesDimension(posted: Seniority | null, wanted: string): Dimension {
  if (posted === null) return { status: 'not_stated', findings: [] }
  const target = wanted.toLowerCase().split(/[^a-z]+/).map((word) => SENIORITY_WORDS[word]).find((level) => level !== undefined)
  const base = { requirement: `${posted} level`, importance: 'preferred' as const, quote: null, evidence: [] }
  if (target === undefined) return { status: 'unknown', findings: [{ ...base, status: 'unknown', note: `your seniority “${wanted}” is not a level this can compare` }] }
  const distance = Math.abs(SENIORITY_RANK[posted] - SENIORITY_RANK[target])
  const note = `${posted} role; you target ${target}`
  if (distance === 0) return { status: 'meets', findings: [{ ...base, status: 'met', note }] }
  return { status: distance === 1 ? 'partial' : 'gap', findings: [{ ...base, status: distance === 1 ? 'short' : 'missing', note }] }
}

function money(minor: number, currency: string): string {
  const format = new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  return format.format(minor / 10 ** digits)
}

function salaryOf(job: MatchJob, profile: MatchCandidate['profile']): { compatibility: SalaryCompatibility; dimension: Dimension } {
  const floor = profile.salaryFloorMinor
  if (floor === null) return { compatibility: 'unknown', dimension: { status: 'not_stated', findings: [] } }
  const floorText = money(floor, profile.salaryCurrency)
  const one = (status: DimensionStatus, findingStatus: Finding['status'], note: string) =>
    ({ status, findings: [{ requirement: `your ${floorText} floor`, importance: 'preferred' as const, quote: null, status: findingStatus, note, evidence: [] }] })
  if (job.salary.source === 'unknown') return { compatibility: 'unknown', dimension: one('unknown', 'unknown', 'no salary posted') }
  const { minMinor, maxMinor, currency } = job.salary
  const range = minMinor !== null && maxMinor !== null ? `${money(minMinor, currency)}–${money(maxMinor, currency)}`
    : minMinor !== null ? `from ${money(minMinor, currency)}` : `up to ${money(maxMinor ?? 0, currency)}`
  if (currency !== profile.salaryCurrency) {
    return { compatibility: 'unknown', dimension: one('unknown', 'unknown', `pays ${range}; your floor is in ${profile.salaryCurrency}`) }
  }
  if (maxMinor !== null && maxMinor < floor) return { compatibility: 'below', dimension: one('gap', 'missing', `pays ${range}, below your ${floorText} floor`) }
  if (minMinor !== null && minMinor >= floor) return { compatibility: 'above', dimension: one('meets', 'met', `pays ${range}, above your ${floorText} floor`) }
  return { compatibility: 'within', dimension: one('meets', 'met', `pays ${range}, which reaches your ${floorText} floor`) }
}

const ARRANGEMENTS: Readonly<Record<string, string>> = { employee: 'an employee', contractor: 'a contractor', eor: 'an employer-of-record hire' }

function employmentDimension(posted: MatchJob['employmentType'], accepted: readonly string[]): Dimension {
  if (posted === 'unknown') return { status: 'not_stated', findings: [] }
  const isAccepted = accepted.includes(posted)
  const note = `hires as ${ARRANGEMENTS[posted] ?? posted}${isAccepted ? '' : `; you accept ${accepted.join(', ')}`}`
  return {
    status: isAccepted ? 'meets' : 'gap',
    findings: [{ requirement: `${posted} arrangement`, importance: 'preferred', quote: null, status: isAccepted ? 'met' : 'missing', note, evidence: [] }],
  }
}

const LEGAL_SUFFIX = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|sa|sas|srl|plc|ag|bv|nv)\b/g
const companyKey = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, ' ').replace(LEGAL_SUFFIX, '').replace(/[\s_]+/g, '')

function preferencesDimension(job: MatchJob, skills: readonly SkillRequirement[], profile: MatchCandidate['profile']): Dimension {
  const findings: Finding[] = []
  const hit = (requirement: string, status: 'met' | 'missing', note: string, quote: string | null) =>
    findings.push({ requirement, importance: 'preferred', quote, status, note, evidence: [] })
  if (profile.excludedCompanies.some((company) => companyKey(company) === companyKey(job.companyName))) {
    hit(`Not ${job.companyName}`, 'missing', `${job.companyName} is on your excluded companies`, null)
  }
  const named = new Map(skills.map((skill) => [skillKey(skill.name), skill]))
  for (const tech of profile.excludedTech) {
    const skill = named.get(skillKey(tech))
    if (skill) hit(`Uses ${skill.name}`, 'missing', `uses ${skill.name}, which you excluded`, skill.quote)
  }
  for (const tech of profile.preferredTech) {
    const skill = named.get(skillKey(tech))
    if (skill) hit(`Uses ${skill.name}`, 'met', `uses ${skill.name}, which you prefer`, skill.quote)
  }
  if (findings.length === 0) return { status: 'not_stated', findings }
  return { status: findings.some((f) => f.status === 'missing') ? 'gap' : 'meets', findings }
}

// ---------------------------------------------------------------------------

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function concernsOf(d: Dimensions, isUnreadable: boolean): string[] {
  const concerns: string[] = []
  for (const f of d.preferences.findings) if (f.status === 'missing' && f.note) concerns.push(`${capitalize(f.note)}.`)
  for (const f of d.salary.findings) if (f.status === 'missing' && f.note) concerns.push(`${capitalize(f.note)}.`)
  for (const f of d.languages.findings) {
    if (f.status === 'missing' && f.importance === 'required') concerns.push(`Requires ${f.requirement}, which is not in your languages.`)
    if (f.status === 'unknown') concerns.push(`Asks for ${f.requirement}; your settings list no languages.`)
  }
  if (isUnreadable) concerns.push('The posting’s requirements could not be read automatically.')
  const missing = d.requiredSkills.findings.filter((f) => f.status === 'missing').map((f) => f.requirement)
  if (missing.length > 0) concerns.push(`Missing required: ${missing.join(', ')}.`)
  for (const f of [...d.requiredSkills.findings, ...d.experience.findings]) {
    if (f.status === 'short' && f.note) concerns.push(`${f.requirement}: ${f.note}.`)
  }
  for (const f of d.employmentType.findings) if (f.status === 'missing' && f.note) concerns.push(`${capitalize(f.note)}.`)
  if (d.seniority.status === 'gap') for (const f of d.seniority.findings) if (f.note) concerns.push(`${capitalize(f.note)}.`)
  if (d.role.status === 'gap') for (const f of d.role.findings) if (f.note) concerns.push(`${capitalize(f.note)}.`)
  return concerns
}

const UNREAD: Dimension = { status: 'unknown', findings: [] }

/**
 * `requirements` is null when the posting could not be read: the text-based dimensions
 * are unknown, never guessed, and the structured ones still compare.
 */
export function compareRequirements(job: MatchJob, requirements: JobRequirements | null, candidate: MatchCandidate, today: Date): MatchResult {
  const { profile, careerItems } = candidate
  const bySkill = evidenceBySkill(careerItems)
  // A skill listed twice ("Node", "Node.js") is one requirement.
  const findingsFor = (importance: Importance) => {
    const byKey = new Map<string, SkillRequirement>()
    for (const skill of requirements?.skills ?? []) {
      if (skill.importance === importance && !byKey.has(skillKey(skill.name))) byKey.set(skillKey(skill.name), skill)
    }
    return [...byKey.values()].map((skill) => skillFinding(skill, bySkill, today))
  }
  const salary = salaryOf(job, profile)
  const dimensions: Dimensions = {
    requiredSkills: requirements ? skillsDimension(findingsFor('required')) : UNREAD,
    preferredSkills: requirements ? skillsDimension(findingsFor('preferred')) : UNREAD,
    experience: requirements ? experienceDimension(requirements, careerItems, today) : UNREAD,
    languages: requirements ? languagesDimension(requirements.languages, profile.spokenLanguages) : UNREAD,
    role: roleDimension(job.title, profile.targetRoles),
    seniority: senioritiesDimension(job.seniority, profile.seniority),
    salary: salary.dimension,
    employmentType: employmentDimension(job.employmentType, profile.employmentTypes),
    preferences: preferencesDimension(job, requirements?.skills ?? [], profile),
  }
  const asked = [...dimensions.requiredSkills.findings, ...dimensions.preferredSkills.findings, ...dimensions.experience.findings, ...dimensions.languages.findings]
  return {
    dimensions,
    salaryCompatibility: salary.compatibility,
    met: asked.filter((f) => f.status === 'met'),
    missing: asked.filter((f) => f.status === 'missing' || f.status === 'short'),
    concerns: concernsOf(dimensions, requirements === null),
  }
}
