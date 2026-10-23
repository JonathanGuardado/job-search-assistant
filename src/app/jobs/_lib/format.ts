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
