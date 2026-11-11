import type { Job, Salary } from '@/modules/jobs'

export function formatSalary(salary: Salary): string | null {
  if (salary.source === 'unknown') return null
  const minorDigits = new Intl.NumberFormat('en', {
    style: 'currency', currency: salary.currency,
  }).resolvedOptions().maximumFractionDigits ?? 0
  const formatter = new Intl.NumberFormat('en', {
    style: 'currency', currency: salary.currency, maximumFractionDigits: 0,
  })
  const format = (minor: number) => formatter.format(minor / 10 ** minorDigits)
  if (salary.minMinor !== null && salary.maxMinor !== null) return `${format(salary.minMinor)}–${format(salary.maxMinor)}`
  if (salary.minMinor !== null) return `From ${format(salary.minMinor)}`
  if (salary.maxMinor !== null) return `Up to ${format(salary.maxMinor)}`
  return null
}

export function formatLocation(location: Job['locationText']): string {
  return location ?? 'Location not stated'
}

const DAY_MS = 86_400_000

/** "Posted today", "Posted 3 days ago", "Posted 2 months ago"; null when the board gave no date. */
export function formatPosted(postedAt: Date | null, now: Date): string | null {
  if (postedAt === null) return null
  const days = Math.max(0, Math.floor((now.getTime() - postedAt.getTime()) / DAY_MS))
  if (days === 0) return 'Posted today'
  const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (days < 30) return `Posted ${relative.format(-days, 'day')}`
  if (days < 365) return `Posted ${relative.format(-Math.floor(days / 30), 'month')}`
  return `Posted ${relative.format(-Math.floor(days / 365), 'year')}`
}

/** A company's letter and a hue derived from its name, so each company keeps one color. */
export function companyMark(companyName: string): { readonly letter: string; readonly hue: number } {
  const letter = companyName.trim().charAt(0).toUpperCase() || '?'
  let hash = 0
  for (const char of companyName) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360
  return { letter, hue: hash }
}
