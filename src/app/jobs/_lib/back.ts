import { z } from 'zod'
import { TAB_LABELS } from './job-list'

/** A path inside /jobs, so a redirect or link built from a form or address never leaves the jobs pages. */
export const BackSchema = z.string().refine((value) => {
  if (!value.startsWith('/jobs')) return false
  const url = new URL(value, 'http://localhost')
  return url.origin === 'http://localhost' && (url.pathname === '/jobs' || url.pathname.startsWith('/jobs/'))
}).catch('/jobs')

/** The list a job page was opened from, with its tab, filters, page and card; the default list otherwise. */
export function listFrom(value: unknown): { readonly href: string; readonly label: string } {
  const back = BackSchema.parse(value)
  const url = new URL(back, 'http://localhost')
  if (url.pathname !== '/jobs') return { href: '/jobs', label: 'Jobs' }
  const tab = url.searchParams.get('tab')
  return { href: back, label: Object.entries(TAB_LABELS).find(([key]) => key === tab)?.[1] ?? 'Jobs' }
}
