import type { DimensionKey, DimensionStatus, Finding, MatchResult, OtherRequirement } from './types.js'

/*
 * A match as the lines a job card shows: one section per dimension that has something to
 * say, each with its evidence. Plain templates over the comparison; no model writes this.
 */

export type CardSection = {
  readonly dimension: DimensionKey | 'notCompared'
  readonly status: DimensionStatus
  readonly headline: string
  readonly details: readonly string[]
}

const MARK: Record<Finding['status'], string> = { met: '✓', short: '~', missing: '✗', unknown: '?' }
const MAX_EVIDENCE = 2

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function findingLine(finding: Finding): string {
  const parts: string[] = []
  if (finding.evidence.length > 0) {
    const shown = finding.evidence.slice(0, MAX_EVIDENCE).map((e) => `${e.label}${e.via === 'implied' ? ` (via ${e.text})` : ''}${e.isVerified ? '' : ' (unconfirmed)'}`)
    const more = finding.evidence.length - MAX_EVIDENCE
    parts.push(shown.join('; ') + (more > 0 ? ` and ${more} more` : ''))
  }
  if (finding.note) parts.push(finding.note)
  if (finding.status === 'missing' && finding.quote) parts.push(`“${finding.quote}”`)
  return `${MARK[finding.status]} ${finding.requirement}${parts.length > 0 ? ` — ${parts.join('; ')}` : ''}`
}

function skillsHeadline(label: string, status: DimensionStatus, findings: readonly Finding[]): string {
  if (status === 'unknown') return `${label}: the posting could not be read`
  if (status === 'not_stated') return `${label}: none stated`
  const met = findings.filter((f) => f.status === 'met').length
  return met === findings.length ? `${label}: all ${met} shown on your record` : `${label}: ${met} of ${findings.length} shown on your record`
}

const firstNote = (findings: readonly Finding[], fallback: string) => capitalize(findings.find((f) => f.note)?.note ?? fallback)

export function explainMatch(result: MatchResult, notCompared: readonly OtherRequirement[]): CardSection[] {
  const d = result.dimensions
  const sections: CardSection[] = [
    { dimension: 'requiredSkills', status: d.requiredSkills.status, headline: skillsHeadline('Required skills', d.requiredSkills.status, d.requiredSkills.findings), details: d.requiredSkills.findings.map(findingLine) },
  ]
  const add = (dimension: DimensionKey, headline: string, details: readonly string[] = []) => {
    if (d[dimension].status !== 'not_stated') sections.push({ dimension, status: d[dimension].status, headline, details })
  }
  add('preferredSkills', skillsHeadline('Nice to have', d.preferredSkills.status, d.preferredSkills.findings), d.preferredSkills.findings.map(findingLine))
  add('experience', `Experience: ${firstNote(d.experience.findings, 'the posting could not be read')}`)
  add('languages', `Languages: ${d.languages.findings.map((f) => `${MARK[f.status]} ${f.requirement}`).join(', ') || 'the posting could not be read'}`, d.languages.findings.filter((f) => f.note).map(findingLine))
  add('role', `Role: ${firstNote(d.role.findings, 'not compared')}`)
  add('seniority', `Seniority: ${firstNote(d.seniority.findings, 'not compared')}`)
  add('salary', `Salary: ${firstNote(d.salary.findings, 'not compared')}`)
  add('employmentType', `Arrangement: ${firstNote(d.employmentType.findings, 'not compared')}`)
  add('preferences', 'Your preferences', d.preferences.findings.map((f) => `${MARK[f.status]} ${capitalize(f.note ?? f.requirement)}`))
  if (notCompared.length > 0) {
    sections.push({
      dimension: 'notCompared', status: 'not_stated',
      headline: `Not compared: ${notCompared.length} other requirement${notCompared.length === 1 ? '' : 's'}`,
      details: notCompared.map((r) => `${r.importance === 'required' ? 'Required' : 'Nice to have'}: ${r.text}`),
    })
  }
  return sections
}
