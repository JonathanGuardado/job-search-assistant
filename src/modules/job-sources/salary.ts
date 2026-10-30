import type { NormalizedSalary } from './adapter.js'

/** undefined: absent. null: present but not a usable amount. */
function salaryBound(value: unknown): number | undefined | null {
  if (value === undefined || value === null) return undefined
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** An annual salary in the currency's minor units, or unknown when anything is ambiguous. Pure. */
export function annualSalary(min: unknown, max: unknown, currency: unknown): NormalizedSalary {
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return { source: 'unknown' }
  const minimum = salaryBound(min)
  const maximum = salaryBound(max)
  if (minimum === null || maximum === null || (minimum === undefined && maximum === undefined)) return { source: 'unknown' }
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) return { source: 'unknown' }
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  const minor = (bound: number | undefined) => bound === undefined ? null : Math.round(bound * 10 ** digits)
  const minMinor = minor(minimum)
  const maxMinor = minor(maximum)
  if ([minMinor, maxMinor].some((bound) => bound !== null && !Number.isSafeInteger(bound))) return { source: 'unknown' }
  return { source: 'posted', minMinor, maxMinor, currency }
}
