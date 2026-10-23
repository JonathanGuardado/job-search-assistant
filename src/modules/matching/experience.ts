/**
 * Months of experience from career-item dates, counted conservatively. Dates are partial
 * (`YYYY` or `YYYY-MM`, never invented), so a year alone is read as late in the year for a
 * start and early for an end: the result is the least the dates can mean, and the card
 * says "at least". Overlapping roles count once.
 */

export type DatedSpan = { readonly startedOn: string | null; readonly endedOn: string | null; readonly isCurrent: boolean }

type MonthIndex = number

function monthIndex(date: string, edge: 'start' | 'end'): MonthIndex {
  const [year, month] = date.split('-').map(Number)
  if (year === undefined || Number.isNaN(year)) throw new Error(`not a partial date: ${date}`)
  if (month === undefined) return year * 12 + (edge === 'start' ? 11 : 0)
  return year * 12 + month - 1
}

export function experienceMonths(spans: readonly DatedSpan[], today: Date): number | null {
  const now = today.getUTCFullYear() * 12 + today.getUTCMonth()
  const intervals: Array<[MonthIndex, MonthIndex]> = []
  for (const span of spans) {
    if (span.startedOn === null) continue
    const end = span.isCurrent ? now : span.endedOn === null ? null : monthIndex(span.endedOn, 'end')
    if (end === null) continue
    const start = monthIndex(span.startedOn, 'start')
    intervals.push([start, Math.max(start, end)])
  }
  if (intervals.length === 0) return null

  intervals.sort((a, b) => a[0] - b[0])
  let total = 0
  let [runStart, runEnd] = intervals[0] ?? [0, 0]
  for (const [start, end] of intervals.slice(1)) {
    if (start <= runEnd) runEnd = Math.max(runEnd, end)
    else {
      total += runEnd - runStart
      ;[runStart, runEnd] = [start, end]
    }
  }
  return total + runEnd - runStart
}

export function yearsLabel(months: number): string {
  if (months < 1) return 'less than a month'
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'}`
}
